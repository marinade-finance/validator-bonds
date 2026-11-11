import { U64_MAX, createUserAndFund } from '@marinade.finance/web3js-1x'
import {
  Keypair,
  LAMPORTS_PER_SOL,
  Lockup,
  StakeProgram,
  SystemProgram,
} from '@solana/web3.js'
import BN from 'bn.js'

import {
  CLUSTER_EFFECTIVE_STAKE,
  currentEpoch,
  executeIx,
  initLiteSvmTest,
  warpToEpoch,
  warpToNextEpoch,
} from './litesvm'
import {
  MerkleTreeNode,
  STAKE_ACCOUNT_PSEUDO_RENT_EXEMPT_RESERVE,
  bondsWithdrawerAuthority,
  claimSettlementV2Instruction,
  claimWithdrawRequestInstruction,
  closeSettlementV2Instruction,
  fundSettlementInstruction,
  getConfig,
  getRentExemptStake,
  getSettlement,
  isEventData,
  minimalSizeStakeAccount,
  resetStakeInstruction,
  settlementStakerAuthority,
} from '../../src'
import {
  CLOSED_VOTE_VARIANTS,
  authorizeStakeAccount,
  createInitializedStakeAccount,
  createVoteAccount,
  delegatedStakeAccount,
  getAndCheckStakeAccount,
  reopenVoteAccount,
  setVoteAccountVariant,
} from '../utils/staking'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
  executeInitWithdrawRequestInstruction,
} from '../utils/testTransactions'

import type { LiteSvmProvider } from './litesvm'
import type { ValidatorBondsProgram } from '../../src'
import type { VoteAccountVariant } from '../utils/staking'
import type { PublicKey } from '@solana/web3.js'

const SOL = LAMPORTS_PER_SOL
const PINNED_RESERVE = STAKE_ACCOUNT_PSEUDO_RENT_EXEMPT_RESERVE

type SourceState =
  | 'activating'
  | 'active'
  | 'deactivating'
  | 'cooling'
  | 'inactive'
  | 'inactiveUnderwater'

// sizes that depend on rent, the config and the remaining claim
type Size =
  | 'amountNeeded'
  | 'splitThresholdMinus1'
  | 'splitThreshold'
  | 'minimumDelegation'
  | 'minSizeMinus1'
  | 'minSize'
  | 'minSizePlus1'
  | 'withdrawsMinimumDelegation'
  | 'withdrawsMinimumDelegationMinus1'
  | 'splitsMinimumDelegation'
  | 'splitsMinimumDelegationMinus1'

type Source = {
  state: SourceState
  // lamports the stake account is created and delegated with
  lamports: number | Size
  // lamports transferred on top after delegation, never delegated
  surplus?: number | Size
  // lamports withdrawn once inactive or cooling, leaving the account below its recorded stake
  withdraw?: number
}

type Path =
  | 'whole'
  | 'split'
  | 'splitWithdraw'
  | 'splitInitialize'
  | 'noop'
  | { error: number; message: string }
  | { panic: number }
  | { stakeError: string }

type Guard = 'voter' | 'staker' | 'withdrawer' | 'lockup'

type Case = {
  name: string
  maxTotalClaim: number
  // an active account of these lamports funds the settlement first (whole-account path)
  preFund?: number
  source: Source
  guard?: Guard
  path: Path
  // also claim the whole settlement, close it and reset the funded account
  lifecycle?: true
  // the vote account is moved into this variant after the source is delegated
  vote?: VoteAccountVariant
  // the path of the same case with a live vote account
  basePath?: Path
}

const CLOSED_VOTE_LOG =
  'cannot be delegated to, funding the whole stake account'

type StakeSnapshot = {
  lamports: number
  stake: number
  activationEpoch: bigint
  deactivationEpoch: bigint
  voter: PublicKey | null
  staker: PublicKey
  withdrawer: PublicKey
}

describe('Validator Bonds fund settlement matrix', () => {
  let provider: LiteSvmProvider
  let program: ValidatorBondsProgram
  let rent: number
  let minSize: number
  let minStake: number
  let configAccount: PublicKey
  let operatorAuthority: Keypair
  let voteAccount: PublicKey
  let voteKeypair: Keypair
  let authorizedWithdrawer: Keypair
  let validatorIdentity: Keypair
  let bondAccount: PublicKey
  let bondsAuthority: PublicKey

  // split threshold: the leftover must reach the minimal size plus the split rent
  const splitThreshold = (claim: number) => claim + 2 * minSize + rent

  beforeAll(async () => {
    ;({ provider, program } = initLiteSvmTest())
    rent = await getRentExemptStake(provider)
  })

  beforeEach(async () => {
    ;({ configAccount, operatorAuthority } = await executeInitConfigInstruction(
      { program, provider, epochsToClaimSettlement: 3 },
    ))
    const config = await getConfig(program, configAccount)
    minSize = minimalSizeStakeAccount(config.minimumStakeLamports).toNumber()
    minStake = config.minimumStakeLamports.toNumber()
    voteKeypair = Keypair.generate()
    ;({ voteAccount, validatorIdentity, authorizedWithdrawer } =
      await createVoteAccount({ provider, voteAccount: voteKeypair }))
    ;({ bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount,
      validatorIdentity,
    }))
    ;[bondsAuthority] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
    )
  })

  async function snapshot(account: PublicKey): Promise<StakeSnapshot | null> {
    const info = await provider.connection.getAccountInfo(account)
    if (info === null) {
      return null
    }
    const [state] = await getAndCheckStakeAccount(provider, account)
    const delegation = state.Stake?.stake.delegation
    const meta = state.Stake?.meta ?? state.Initialized?.meta
    if (meta === undefined) {
      throw new Error(`stake account ${account.toBase58()} is not initialized`)
    }
    return {
      lamports: info.lamports,
      stake: delegation ? Number(delegation.stake.toString()) : 0,
      activationEpoch: BigInt(delegation?.activationEpoch.toString() ?? '0'),
      deactivationEpoch: BigInt(
        delegation?.deactivationEpoch.toString() ?? U64_MAX.toString(),
      ),
      voter: delegation?.voterPubkey ?? null,
      staker: meta.authorized.staker,
      withdrawer: meta.authorized.withdrawer,
    }
  }

  async function buildSource(
    source: Source & { lamports: number; surplus?: number },
    guard?: Guard,
    settlementAccount?: PublicKey,
  ): Promise<PublicKey> {
    const custodian = Keypair.generate()
    const voteToDelegate =
      guard === 'voter'
        ? (await createVoteAccount({ provider })).voteAccount
        : voteAccount
    const lockup =
      guard === 'lockup'
        ? new Lockup(
            0,
            Number(await currentEpoch(provider)) + 100,
            custodian.publicKey,
          )
        : undefined
    const { stakeAccount, staker, withdrawer } = await delegatedStakeAccount({
      provider,
      lamports: source.lamports,
      voteAccountToDelegate: voteToDelegate,
      lockup,
    })
    const deactivate = async () =>
      provider.sendIx(
        [staker],
        StakeProgram.deactivate({
          stakePubkey: stakeAccount,
          authorizedPubkey: staker.publicKey,
        }),
      )
    const withdraw = async () =>
      provider.sendIx(
        [withdrawer],
        StakeProgram.withdraw({
          stakePubkey: stakeAccount,
          authorizedPubkey: withdrawer.publicKey,
          toPubkey: provider.walletPubkey,
          lamports: source.withdraw ?? 0,
        }),
      )
    switch (source.state) {
      case 'activating':
        break
      case 'active':
        await warpToNextEpoch(provider)
        break
      case 'deactivating':
        await warpToNextEpoch(provider)
        await deactivate()
        break
      case 'cooling': {
        await warpToNextEpoch(provider)
        await deactivate()
        // the cluster deactivates enough in this epoch to leave about 1.5 SOL of the stake effective
        const stake = BigInt(source.lamports - rent)
        const deactivationEpoch = await currentEpoch(provider)
        warpToEpoch(provider, deactivationEpoch + 1n, {
          epoch: deactivationEpoch,
          deactivating:
            (CLUSTER_EFFECTIVE_STAKE * 9n * stake) /
            (100n * (stake - 1_500_000_000n)),
        })
        if (source.withdraw !== undefined) {
          await withdraw()
        }
        break
      }
      case 'inactive':
        await warpToNextEpoch(provider)
        await deactivate()
        await warpToNextEpoch(provider)
        break
      case 'inactiveUnderwater':
        // deactivated in its activation epoch, so inactive at once with the full recorded stake
        await deactivate()
        await withdraw()
        break
    }
    if (source.surplus) {
      await provider.sendIx(
        [],
        SystemProgram.transfer({
          fromPubkey: provider.walletPubkey,
          toPubkey: stakeAccount,
          lamports: source.surplus,
        }),
      )
    }
    const settlementStaker =
      settlementAccount &&
      settlementStakerAuthority(settlementAccount, program.programId)[0]
    await authorizeStakeAccount({
      provider,
      stakeAccount,
      authority: withdrawer,
      staker: guard === 'staker' ? settlementStaker : bondsAuthority,
      withdrawer: guard === 'withdrawer' ? undefined : bondsAuthority,
      custodian: guard === 'lockup' ? custodian : undefined,
    })
    return stakeAccount
  }

  async function fund(settlementAccount: PublicKey, stakeAccount: PublicKey) {
    const payer = (await createUserAndFund({
      provider,
      lamports: SOL,
    })) as Keypair
    const split = Keypair.generate()
    const { instruction } = await fundSettlementInstruction({
      program,
      settlementAccount,
      stakeAccount,
      splitStakeAccount: split,
      splitStakeRentPayer: payer,
    })
    const send = () =>
      executeIx(
        provider,
        [provider.wallet, payer, split, operatorAuthority],
        instruction,
      )
    return { payer, split: split.publicKey, send }
  }

  const CASES: Case[] = [
    // amount vs need, active source, fresh settlement of 10 SOL
    {
      name: 'active, below the claim: whole account, underfunds',
      maxTotalClaim: 10 * SOL,
      source: { state: 'active', lamports: 5 * SOL },
      path: 'whole',
    },
    {
      name: 'active, exactly amount_needed: whole account funds the claim exactly',
      maxTotalClaim: 10 * SOL,
      source: { state: 'active', lamports: 'amountNeeded' },
      path: 'whole',
    },
    {
      name: 'active, split threshold - 1 lamport: whole account, maximal overfund',
      lifecycle: true,
      maxTotalClaim: 10 * SOL,
      source: { state: 'active', lamports: 'splitThresholdMinus1' },
      path: 'whole',
    },
    {
      name: 'active, exactly the split threshold: split',
      maxTotalClaim: 10 * SOL,
      source: { state: 'active', lamports: 'splitThreshold' },
      path: 'split',
    },
    {
      name: 'active, well above the claim: split',
      lifecycle: true,
      maxTotalClaim: 10 * SOL,
      source: { state: 'active', lamports: 50 * SOL },
      path: 'split',
    },
    // non-delegated surplus
    {
      name: 'active, small surplus: split keeps the surplus in the funded account',
      maxTotalClaim: 10 * SOL,
      source: { state: 'active', lamports: 50 * SOL, surplus: SOL },
      path: 'split',
    },
    {
      name: 'active, surplus above the claim: withdraw the excess, then split',
      maxTotalClaim: 10 * SOL,
      source: { state: 'active', lamports: 20 * SOL, surplus: 15 * SOL },
      path: 'splitWithdraw',
    },
    {
      name: 'active at minimum delegation, large surplus: withdraw all, initialize and delegate',
      lifecycle: true,
      maxTotalClaim: 10 * SOL,
      source: {
        state: 'active',
        lamports: 'minimumDelegation',
        surplus: 30 * SOL,
      },
      path: 'splitInitialize',
    },
    // below twice the minimum delegation the stake program cannot split an active account
    {
      name: 'active below twice the minimum delegation, large surplus: withdraw the surplus, initialize and delegate',
      lifecycle: true,
      maxTotalClaim: 0.3 * SOL,
      source: { state: 'active', lamports: 1.5 * SOL, surplus: 3 * SOL },
      path: 'splitInitialize',
    },
    {
      name: 'active below twice the minimum delegation, surplus leaves exactly the minimum delegation: delegate it',
      lifecycle: true,
      maxTotalClaim: 0.1 * SOL,
      source: {
        state: 'active',
        lamports: 1.5 * SOL,
        surplus: 'withdrawsMinimumDelegation',
      },
      path: 'splitInitialize',
    },
    {
      name: 'active below twice the minimum delegation, surplus leaves 1 lamport below the minimum delegation: whole account',
      lifecycle: true,
      maxTotalClaim: 0.1 * SOL,
      source: {
        state: 'active',
        lamports: 1.5 * SOL,
        surplus: 'withdrawsMinimumDelegationMinus1',
      },
      path: 'whole',
    },
    {
      name: 'active, large surplus, split after the withdraw is exactly the minimum delegation: split',
      lifecycle: true,
      maxTotalClaim: 0.3 * SOL,
      source: {
        state: 'active',
        lamports: 'splitsMinimumDelegation',
        surplus: 3 * SOL,
      },
      path: 'splitWithdraw',
    },
    {
      name: 'active, large surplus, split after the withdraw is 1 lamport below the minimum delegation: keep it, delegate the surplus',
      lifecycle: true,
      maxTotalClaim: 0.3 * SOL,
      source: {
        state: 'active',
        lamports: 'splitsMinimumDelegationMinus1',
        surplus: 3 * SOL,
      },
      path: 'splitInitialize',
    },
    {
      name: 'active below twice the minimum delegation, small surplus: whole account',
      lifecycle: true,
      maxTotalClaim: 0.1 * SOL,
      source: { state: 'active', lamports: 1.5 * SOL, surplus: 0.8 * SOL },
      path: 'whole',
    },
    {
      name: 'cooling below twice the minimum delegation, large surplus: withdraw the surplus, initialize and delegate',
      lifecycle: true,
      maxTotalClaim: 0.3 * SOL,
      source: { state: 'cooling', lamports: 1.8 * SOL, surplus: 3 * SOL },
      path: 'splitInitialize',
    },
    // settlement state
    {
      name: 'partially funded settlement: split funds the remaining claim',
      maxTotalClaim: 10 * SOL,
      preFund: 4 * SOL,
      source: { state: 'active', lamports: 50 * SOL },
      path: 'split',
    },
    {
      name: 'fully funded settlement: no-op, split rent refunded',
      maxTotalClaim: 2 * SOL,
      preFund: 4 * SOL,
      source: { state: 'active', lamports: 50 * SOL },
      path: 'noop',
    },
    // source state
    {
      name: 'activating (this epoch): split',
      maxTotalClaim: 10 * SOL,
      source: { state: 'activating', lamports: 50 * SOL },
      path: 'split',
    },
    {
      name: 'deactivating (this epoch): split, not deactivated again',
      maxTotalClaim: 10 * SOL,
      source: { state: 'deactivating', lamports: 50 * SOL },
      path: 'split',
    },
    {
      name: 'cooling down over several epochs, little stake still effective: split',
      maxTotalClaim: 10 * SOL,
      source: { state: 'cooling', lamports: 50 * SOL },
      path: 'split',
    },
    {
      name: 'cooling, withdrawn below its recorded stake: the stake program rejects the split',
      maxTotalClaim: 5 * SOL,
      source: { state: 'cooling', lamports: 50 * SOL, withdraw: 10 * SOL },
      path: { stakeError: 'insufficient funds for instruction' },
    },
    {
      name: 'inactive, below the claim: whole account',
      maxTotalClaim: 10 * SOL,
      source: { state: 'inactive', lamports: 5 * SOL },
      path: 'whole',
    },
    {
      name: 'inactive, above the claim: withdraw all, initialize and delegate a healthy leftover',
      lifecycle: true,
      maxTotalClaim: 10 * SOL,
      source: { state: 'inactive', lamports: 50 * SOL },
      path: 'splitInitialize',
    },
    {
      name: 'inactive underwater, below the claim: whole account',
      maxTotalClaim: 40 * SOL,
      source: {
        state: 'inactiveUnderwater',
        lamports: 50 * SOL,
        withdraw: 20 * SOL,
      },
      path: 'whole',
    },
    {
      name: 'inactive underwater, above the claim: withdraw all, initialize and delegate a healthy leftover',
      maxTotalClaim: 10 * SOL,
      source: {
        state: 'inactiveUnderwater',
        lamports: 50 * SOL,
        withdraw: 20 * SOL,
      },
      path: 'splitInitialize',
    },
    // rent gap window: live minimum <= lamports < minimal size counted with the pinned reserve
    {
      name: 'rent gap, live minimum (1 SOL + live rent): not big enough to fund',
      maxTotalClaim: 10 * SOL,
      source: { state: 'active', lamports: 'minimumDelegation' },
      path: { error: 6083, message: 'not big enough to be funded' },
    },
    {
      name: 'rent gap, minimal size - 1 lamport: not big enough to fund',
      maxTotalClaim: 10 * SOL,
      source: { state: 'active', lamports: 'minSizeMinus1' },
      path: { error: 6083, message: 'not big enough to be funded' },
    },
    {
      name: 'exactly the minimal size: nothing to fund',
      maxTotalClaim: 10 * SOL,
      source: { state: 'active', lamports: 'minSize' },
      path: { error: 6083, message: 'not big enough to be funded' },
    },
    {
      name: 'minimal size + 1 lamport: whole account funds 1 lamport',
      maxTotalClaim: 10 * SOL,
      source: { state: 'active', lamports: 'minSizePlus1' },
      path: 'whole',
    },
    // guards
    {
      name: 'delegated to another vote account',
      maxTotalClaim: 10 * SOL,
      source: { state: 'active', lamports: 50 * SOL },
      guard: 'voter',
      path: { error: 6020, message: 'delegated to a wrong validator' },
    },
    {
      name: 'staker is the settlement authority',
      maxTotalClaim: 10 * SOL,
      source: { state: 'active', lamports: 50 * SOL },
      guard: 'staker',
      path: { error: 6028, message: 'already funded to a settlement' },
    },
    {
      name: 'withdrawer is not the bonds authority',
      maxTotalClaim: 10 * SOL,
      source: { state: 'active', lamports: 50 * SOL },
      guard: 'withdrawer',
      path: { error: 6012, message: 'Wrong withdrawer authority' },
    },
    {
      name: 'lockup in force',
      maxTotalClaim: 10 * SOL,
      source: { state: 'active', lamports: 50 * SOL },
      guard: 'lockup',
      path: { error: 6030, message: 'locked-up' },
    },
  ]

  function resolveLamports(lamports: number | Size, claim: number): number {
    switch (lamports) {
      case 'amountNeeded':
        return claim + minSize
      case 'splitThresholdMinus1':
        return splitThreshold(claim) - 1
      case 'splitThreshold':
        return splitThreshold(claim)
      case 'minimumDelegation':
        return SOL + rent
      case 'minSizeMinus1':
        return minSize - 1
      case 'minSize':
        return minSize
      case 'minSizePlus1':
        return minSize + 1
      // a surplus whose excess over the claim and the pinned reserve is the minimum delegation
      case 'withdrawsMinimumDelegation':
        return minStake + claim + PINNED_RESERVE - rent
      case 'withdrawsMinimumDelegationMinus1':
        return minStake + claim + PINNED_RESERVE - rent - 1
      // a delegated account whose split after the surplus withdraw is the minimum delegation
      case 'splitsMinimumDelegation':
        return 2 * minStake + 2 * rent
      case 'splitsMinimumDelegationMinus1':
        return 2 * minStake + 2 * rent - 1
      default:
        return lamports
    }
  }

  async function prepare(c: Case) {
    // a single-leaf merkle tree claiming the whole settlement: the root is the leaf hash, no proof
    const claimer = {
      staker: Keypair.generate(),
      withdrawer: Keypair.generate(),
    }
    const leaf = new MerkleTreeNode({
      stakeAuthority: claimer.staker.publicKey,
      withdrawAuthority: claimer.withdrawer.publicKey,
      claim: c.maxTotalClaim,
      index: 0,
    })
    const { settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: await currentEpoch(provider),
      maxTotalClaim: c.maxTotalClaim,
      merkleRoot: leaf.hashLeafNode().buffer,
    })
    if (c.preFund !== undefined) {
      const preFundAccount = await buildSource({
        state: 'active',
        lamports: c.preFund,
      })
      await (await fund(settlementAccount, preFundAccount)).send()
    }
    const settlementBefore = await getSettlement(program, settlementAccount)
    const preFunded = c.preFund === undefined ? 0 : c.preFund - minSize
    if (Number(settlementBefore.lamportsFunded.toString()) !== preFunded) {
      throw new Error(
        `pre-funding expected ${preFunded}, got ${settlementBefore.lamportsFunded.toString()}`,
      )
    }
    const claim =
      c.maxTotalClaim - Number(settlementBefore.lamportsFunded.toString())
    const stakeAccount = await buildSource(
      {
        ...c.source,
        lamports: resolveLamports(c.source.lamports, claim),
        surplus:
          c.source.surplus === undefined
            ? undefined
            : resolveLamports(c.source.surplus, claim),
      },
      c.guard,
      settlementAccount,
    )
    if (c.vote !== undefined) {
      await setVoteAccountVariant({
        provider,
        voteAccount: voteKeypair,
        authorizedWithdrawer,
        variant: c.vote,
      })
    }
    const before = (await snapshot(stakeAccount))!
    const epoch = await currentEpoch(provider)
    const funding = await fund(settlementAccount, stakeAccount)
    return {
      claimer,
      settlementAccount,
      settlementBefore,
      claim,
      stakeAccount,
      before,
      epoch,
      ...funding,
    }
  }

  async function settle(prepared: Awaited<ReturnType<typeof prepare>>) {
    const { innerInstructions, logMessages } = await prepared.send()
    const settlement = await getSettlement(program, prepared.settlementAccount)
    return {
      logs: logMessages.join('\n'),
      events: innerInstructions
        .filter(
          ix => ix.programId.equals(program.programId) && isEventData(ix.data),
        )
        .map(ix =>
          program.coder.events.decode(ix.data.subarray(8).toString('base64')),
        ),
      after: (await snapshot(prepared.stakeAccount))!,
      leftover: await snapshot(prepared.split),
      settlement,
      funded:
        Number(settlement.lamportsFunded.toString()) -
        Number(prepared.settlementBefore.lamportsFunded.toString()),
      payerLamports: (
        await provider.connection.getAccountInfo(prepared.payer.publicKey)
      )?.lamports,
    }
  }

  function failureOutcome(e: unknown): Path {
    const logs = ((e as { logs?: string[] }).logs ?? []).join('\n')
    const panic = /settlement\/fund_settlement\.rs at (\d+):/.exec(logs)
    if (panic) {
      return { panic: Number(panic[1]) }
    }
    const stakeError =
      /Program Stake11111111111111111111111111111111111111 failed: ([^\n]*)/.exec(
        logs,
      )
    if (stakeError) {
      return { stakeError: stakeError[1]! }
    }
    const error = /Error Number: (\d+)\. Error Message: ([^\n]*)/.exec(logs)
    return error
      ? { error: Number(error[1]), message: error[2]! }
      : { error: -1, message: logs }
  }

  // the split path the program model predicts for this source and claim
  function splitModel(
    before: StakeSnapshot,
    claim: number,
    epoch: bigint,
    inactive: boolean,
  ) {
    const leftover0 = before.lamports - (claim + minSize) - rent
    // S1: a fully inactive account stakes nothing, whatever stake it still records
    const nonDelegated = before.lamports - (inactive ? 0 : before.stake)
    const excess = Math.max(0, nonDelegated - (claim + PINNED_RESERVE))
    const withdrawn = Math.min(excess, leftover0)
    // S2: an active split below the minimum delegation fails, the funded account keeps it
    const splitMoved =
      leftover0 - withdrawn < minStake ? 0 : leftover0 - withdrawn
    const path: Path =
      splitMoved === 0 && withdrawn < minStake
        ? 'whole'
        : excess === 0
          ? 'split'
          : splitMoved > 0
            ? 'splitWithdraw'
            : 'splitInitialize'
    const leftoverLamports = withdrawn + splitMoved
    const initialized = path === 'splitInitialize'
    return {
      path,
      withdrawn,
      leftoverLamports,
      sourceLamports: before.lamports - leftoverLamports,
      sourceStake: initialized ? before.stake : before.stake - splitMoved,
      leftoverStake: initialized ? withdrawn : splitMoved,
      leftoverActivationEpoch: initialized ? epoch : before.activationEpoch,
      leftoverDeactivationEpoch: initialized
        ? BigInt(U64_MAX.toString())
        : before.deactivationEpoch,
    }
  }

  function expectedFailure(path: Path) {
    return typeof path === 'object' && 'error' in path
      ? { ...path, message: expect.stringContaining(path.message) }
      : path
  }

  // a closed vote account turns only the initialize+delegate split into a whole funding
  const pathUnderVote = (path: Path, vote: VoteAccountVariant): Path =>
    CLOSED_VOTE_VARIANTS.includes(vote) && path === 'splitInitialize'
      ? 'whole'
      : path
  const VOTE_VARIANTS: VoteAccountVariant[] = [
    ...CLOSED_VOTE_VARIANTS,
    'reopened',
    'reopenedZeroed',
  ]
  CASES.push(
    ...CASES.flatMap(({ lifecycle: _lifecycle, ...c }) =>
      VOTE_VARIANTS.map(vote => ({
        ...c,
        name: `${c.name} [vote ${vote}]`,
        vote,
        basePath: c.path,
        path: pathUnderVote(c.path, vote),
      })),
    ),
  )

  const failing = CASES.filter(c => typeof c.path === 'object')
  const whole = CASES.filter(c => c.path === 'whole')
  const noop = CASES.filter(c => c.path === 'noop')
  const splits = CASES.filter(
    c => typeof c.path === 'string' && c.path.startsWith('split'),
  )

  it.each(failing)('fails: $name', async c => {
    const prepared = await prepare(c)
    const failure = await prepared.send().then(
      () => undefined,
      (e: unknown) => e,
    )
    expect(failureOutcome(failure)).toEqual(expectedFailure(c.path))
    expect(await snapshot(prepared.stakeAccount)).toEqual(prepared.before)
    expect(
      (await getSettlement(program, prepared.settlementAccount)).lamportsFunded,
    ).toEqual(prepared.settlementBefore.lamportsFunded)
  })

  it.each(noop)('no-op: $name', async c => {
    const prepared = await prepare(c)
    const { after, leftover, funded, payerLamports } = await settle(prepared)
    // F9
    expect(funded).toEqual(0)
    expect(after).toEqual(prepared.before)
    expect(leftover).toBeNull()
    expect(payerLamports).toEqual(SOL)
  })

  function expectFundedShape(
    prepared: Awaited<ReturnType<typeof prepare>>,
    settled: Awaited<ReturnType<typeof settle>>,
    maxTotalClaim: number,
    overfundBound = minSize + rent,
  ) {
    const { before, epoch } = prepared
    const [settlementStaker] = settlementStakerAuthority(
      prepared.settlementAccount,
      program.programId,
    )
    // F6, F8: handed to the settlement, deactivated, same voter
    expect({
      staker: settled.after.staker,
      withdrawer: settled.after.withdrawer,
      voter: settled.after.voter,
      activationEpoch: settled.after.activationEpoch,
      deactivationEpoch: settled.after.deactivationEpoch,
    }).toEqual({
      staker: settlementStaker,
      withdrawer: bondsAuthority,
      voter: voteAccount,
      activationEpoch: before.activationEpoch,
      deactivationEpoch:
        before.deactivationEpoch === BigInt(U64_MAX.toString())
          ? epoch
          : before.deactivationEpoch,
    })
    // F2: overfunding bounded by the minimal size plus the split rent
    expect(
      Number(settled.settlement.lamportsFunded.toString()) - maxTotalClaim,
    ).toBeLessThan(overfundBound)
    const { settlement, funded, leftover } = settled
    expect(settled.events).toEqual([
      {
        name: 'fundSettlementEvent',
        data: {
          bond: settlement.bond,
          settlement: prepared.settlementAccount,
          fundingAmount: new BN(funded),
          stakeAccount: prepared.stakeAccount,
          lamportsFunded: settlement.lamportsFunded,
          lamportsClaimed: new BN(0),
          merkleNodesClaimed: new BN(0),
          splitStakeAccount:
            leftover === null
              ? null
              : {
                  address: prepared.split,
                  amount: new BN(leftover.lamports),
                },
          splitRentCollector: settlement.splitRentCollector,
          splitRentAmount: settlement.splitRentAmount,
        },
      },
    ])
  }

  it.each(whole)('whole account: $name', async c => {
    const prepared = await prepare(c)
    const { before, claim, epoch } = prepared
    // splittable, but the split could not be delegated: whole-account fallback
    const fallback = before.lamports >= splitThreshold(claim)
    const model = fallback
      ? splitModel(
          before,
          claim,
          epoch,
          c.source.state === 'inactive' ||
            c.source.state === 'inactiveUnderwater',
        )
      : undefined
    const modelPath = model?.path ?? 'whole'
    // with a live vote account the model predicts the whole account; otherwise the live-case path
    expect(modelPath).toEqual(c.basePath ?? 'whole')
    const forcedByVote = modelPath !== 'whole'
    const settled = await settle(prepared)
    expectFundedShape(
      prepared,
      settled,
      c.maxTotalClaim,
      // forced only while the leftover after the withdraw stays below the minimum delegation
      forcedByVote
        ? model!.withdrawn + minStake + rent
        : fallback
          ? 2 * minStake + rent
          : minSize + rent,
    )
    expect(settled.logs.includes(CLOSED_VOTE_LOG)).toEqual(forcedByVote)
    expect(settled.funded).toEqual(before.lamports - minSize)
    expect(settled.after.lamports).toEqual(before.lamports)
    expect(settled.after.stake).toEqual(before.stake)
    expect(settled.leftover).toBeNull()
    expect(settled.payerLamports).toEqual(SOL)
    expect(settled.settlement.splitRentCollector).toEqual(
      prepared.settlementBefore.splitRentCollector,
    )
  })

  it.each(splits)('split: $name', async c => {
    const prepared = await prepare(c)
    const model = splitModel(
      prepared.before,
      prepared.claim,
      prepared.epoch,
      c.source.state === 'inactive' || c.source.state === 'inactiveUnderwater',
    )
    expect(model.path).toEqual(c.path)
    const settled = await settle(prepared)
    expectFundedShape(prepared, settled, c.maxTotalClaim)
    expect(settled.logs).not.toContain(CLOSED_VOTE_LOG)
    const { before, claim, payer } = prepared
    const { after, settlement } = settled
    const leftover = settled.leftover!
    expect(settled.funded).toEqual(claim)
    expect(settlement.splitRentCollector).toEqual(payer.publicKey)
    expect(settlement.splitRentAmount).toEqual(rent)
    expect(settled.payerLamports).toEqual(SOL - rent)
    expect(after.lamports).toEqual(model.sourceLamports)
    // a leftover below the minimum delegation stays in the funded account
    expect(after.lamports - (claim + minSize + rent)).toBeGreaterThanOrEqual(0)
    expect(after.lamports - (claim + minSize + rent)).toBeLessThan(minStake)
    // F3: nothing leaves bond custody, the split rent is the only lamports added
    expect(after.lamports + leftover.lamports).toEqual(before.lamports + rent)
    expect({
      sourceStake: after.stake,
      leftoverLamports: leftover.lamports,
      leftoverStake: leftover.stake,
      leftoverActivationEpoch: leftover.activationEpoch,
      leftoverDeactivationEpoch: leftover.deactivationEpoch,
      leftoverStaker: leftover.staker,
      leftoverWithdrawer: leftover.withdrawer,
      leftoverVoter: leftover.voter,
    }).toEqual({
      sourceStake: model.sourceStake,
      leftoverLamports: model.leftoverLamports + rent,
      leftoverStake: model.leftoverStake,
      leftoverActivationEpoch: model.leftoverActivationEpoch,
      leftoverDeactivationEpoch: model.leftoverDeactivationEpoch,
      leftoverStaker: bondsAuthority,
      leftoverWithdrawer: bondsAuthority,
      leftoverVoter: voteAccount,
    })
    // F5: a leftover returning to the bond is not underwater
    expect(leftover.stake).toBeLessThanOrEqual(leftover.lamports - rent)
  })
  // F4, F7, L1: claim the whole settlement, close it, reset the funded account
  it.each(CASES.filter(c => c.lifecycle))('lifecycle: $name', async c => {
    const prepared = await prepare(c)
    const settled = await settle(prepared)
    const { before, claimer, settlementAccount, stakeAccount } = prepared
    const settlementData = await getSettlement(program, settlementAccount)

    await warpToNextEpoch(provider)
    const { stakeAccount: claimTo } = await delegatedStakeAccount({
      provider,
      voteAccountToDelegate: voteAccount,
      staker: claimer.staker,
      withdrawer: claimer.withdrawer,
    })
    const claimToLamports = (await snapshot(claimTo))!.lamports
    const { instruction: claimIx } = await claimSettlementV2Instruction({
      program,
      claimAmount: c.maxTotalClaim,
      index: 0,
      merkleProof: [],
      stakeAccountFrom: stakeAccount,
      stakeAccountTo: claimTo,
      stakeAccountStaker: claimer.staker.publicKey,
      stakeAccountWithdrawer: claimer.withdrawer.publicKey,
      settlementAccount,
    })
    await provider.sendIx([], claimIx)
    const claimed = (await snapshot(stakeAccount))!
    expect((await snapshot(claimTo))!.lamports).toEqual(
      claimToLamports + c.maxTotalClaim,
    )
    expect(claimed.lamports).toEqual(settled.after.lamports - c.maxTotalClaim)
    // F4: after paying the claim the funded account still keeps the minimal size
    expect(claimed.lamports).toBeGreaterThanOrEqual(minSize)

    warpToEpoch(
      provider,
      BigInt(settlementData.epochCreatedFor.toString()) + 4n,
    )
    const { instruction: closeIx } = await closeSettlementV2Instruction({
      program,
      settlementAccount,
      splitRentRefundAccount: stakeAccount,
    })
    await provider.sendIx([], closeIx)
    expect(
      await provider.connection.getAccountInfo(settlementAccount),
    ).toBeNull()
    // F7: the split rent payer gets the rent back on close
    expect(
      (await provider.connection.getAccountInfo(prepared.payer.publicKey))
        ?.lamports,
    ).toEqual(SOL)

    const { instruction: resetIx } = await resetStakeInstruction({
      program,
      stakeAccount,
      settlementAccount,
      configAccount,
      voteAccount,
    })
    await provider.sendIx([], resetIx)
    const reset = (await snapshot(stakeAccount))!
    const leftover = await snapshot(prepared.split)
    // reset re-delegates the funded account, so its recorded stake is rewritten from its lamports
    expect({
      staker: reset.staker,
      withdrawer: reset.withdrawer,
      voter: reset.voter,
      stake: reset.stake,
      activationEpoch: reset.activationEpoch,
      deactivationEpoch: reset.deactivationEpoch,
    }).toEqual({
      staker: bondsAuthority,
      withdrawer: bondsAuthority,
      voter: voteAccount,
      stake: reset.lamports - rent,
      activationEpoch: await currentEpoch(provider),
      deactivationEpoch: BigInt(U64_MAX.toString()),
    })
    // no instruction touches the leftover after funding: an underwater one stays underwater
    expect(leftover).toEqual(settled.leftover)
    expect(
      leftover === null || leftover.stake <= leftover.lamports - rent,
    ).toBe(true)
    // L1: bond custody lost exactly the claim
    expect(reset.lamports + (leftover?.lamports ?? 0)).toEqual(
      before.lamports - c.maxTotalClaim,
    )
  })
  // the vote account changes after funding: closed, or a closed one reopened before the reset
  const LIFECYCLE_VOTE_CASES: {
    name: string
    base?: string
    voteAtFund: VoteAccountVariant
    voteAtReset: VoteAccountVariant | 'reopen'
  }[] = [
    {
      name: 'split while live, closed before reset',
      voteAtFund: 'live',
      voteAtReset: 'closed',
    },
    ...CLOSED_VOTE_VARIANTS.map(v => ({
      name: `split while ${v}, still ${v} at reset`,
      voteAtFund: v,
      voteAtReset: v,
    })),
    {
      name: 'split while closed, reopened before reset',
      voteAtFund: 'closed',
      voteAtReset: 'reopen',
    },
    {
      name: 'split while zeroed, re-initialized before reset',
      voteAtFund: 'zeroed',
      voteAtReset: 'reopen',
    },
    {
      name: 'whole while closed (inactive source), still closed at reset',
      base: 'inactive, above the claim: withdraw all, initialize and delegate a healthy leftover',
      voteAtFund: 'closed',
      voteAtReset: 'closed',
    },
  ]

  it.each(LIFECYCLE_VOTE_CASES)(
    'lifecycle with vote account: $name',
    async ({
      base: baseName = 'active, well above the claim: split',
      voteAtFund,
      voteAtReset,
    }) => {
      const base = CASES.find(c => c.name === baseName)!
      const prepared = await prepare({ ...base, vote: voteAtFund })
      const settled = await settle(prepared)
      const { before, claimer, settlementAccount, stakeAccount } = prepared
      const wholeFunded =
        base.path === 'splitInitialize' &&
        CLOSED_VOTE_VARIANTS.includes(voteAtFund)
      expect(settled.logs.includes(CLOSED_VOTE_LOG)).toEqual(wholeFunded)
      expect(settled.leftover === null).toEqual(wholeFunded)
      expect(settled.leftover?.voter ?? null).toEqual(
        wholeFunded ? null : voteAccount,
      )
      expect(settled.funded).toEqual(
        wholeFunded ? before.lamports - minSize : base.maxTotalClaim,
      )
      const settlementData = await getSettlement(program, settlementAccount)

      await warpToNextEpoch(provider)
      // the claimed-to account must not depend on the bond's vote account
      const { stakeAccount: claimTo } = await delegatedStakeAccount({
        provider,
        staker: claimer.staker,
        withdrawer: claimer.withdrawer,
      })
      const { instruction: claimIx } = await claimSettlementV2Instruction({
        program,
        claimAmount: base.maxTotalClaim,
        index: 0,
        merkleProof: [],
        stakeAccountFrom: stakeAccount,
        stakeAccountTo: claimTo,
        stakeAccountStaker: claimer.staker.publicKey,
        stakeAccountWithdrawer: claimer.withdrawer.publicKey,
        settlementAccount,
      })
      await provider.sendIx([], claimIx)
      const claimed = (await snapshot(stakeAccount))!
      expect(claimed.lamports).toEqual(
        settled.after.lamports - base.maxTotalClaim,
      )
      expect(claimed.lamports).toBeGreaterThanOrEqual(minSize)

      warpToEpoch(
        provider,
        BigInt(settlementData.epochCreatedFor.toString()) + 4n,
      )
      const { instruction: closeIx } = await closeSettlementV2Instruction({
        program,
        settlementAccount,
        splitRentRefundAccount: stakeAccount,
      })
      await provider.sendIx([], closeIx)
      expect(
        await provider.connection.getAccountInfo(settlementAccount),
      ).toBeNull()
      expect(
        (await provider.connection.getAccountInfo(prepared.payer.publicKey))
          ?.lamports,
      ).toEqual(SOL)
      const closed = (await snapshot(stakeAccount))!

      if (voteAtReset === 'reopen') {
        await reopenVoteAccount({
          provider,
          voteAccount: voteKeypair,
          authorizedWithdrawer,
        })
      } else if (voteAtReset !== voteAtFund) {
        await setVoteAccountVariant({
          provider,
          voteAccount: voteKeypair,
          authorizedWithdrawer,
          variant: voteAtReset,
        })
      }
      const { instruction: resetIx } = await resetStakeInstruction({
        program,
        stakeAccount,
        settlementAccount,
        configAccount,
        voteAccount,
      })
      await provider.sendIx([], resetIx)
      const reset = (await snapshot(stakeAccount))!
      const leftover = await snapshot(prepared.split)
      const redelegated = voteAtReset === 'reopen'
      expect(reset).toEqual({
        ...closed,
        staker: bondsAuthority,
        ...(redelegated
          ? {
              stake: closed.lamports - rent,
              activationEpoch: await currentEpoch(provider),
              deactivationEpoch: BigInt(U64_MAX.toString()),
            }
          : {}),
      })
      expect(reset.voter).toEqual(voteAccount)
      // the split leftover is untouched by the claim, the close and the vote account changes
      expect(leftover).toEqual(settled.leftover)
      // L1: bond custody lost exactly the claim
      expect(reset.lamports + (leftover?.lamports ?? 0)).toEqual(
        before.lamports - base.maxTotalClaim,
      )
    },
  )

  it('sibling settlement: under a closed vote account the split leftover funds a second settlement of the bond', async () => {
    const base = CASES.find(
      c => c.name === 'active, well above the claim: split',
    )!
    const { settlementAccount: sibling } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: await currentEpoch(provider),
      maxTotalClaim: base.maxTotalClaim,
    })
    const first = await prepare({ ...base, vote: 'closed' })
    const settledFirst = await settle(first)
    expect(settledFirst.logs).not.toContain(CLOSED_VOTE_LOG)
    expect(settledFirst.funded).toEqual(base.maxTotalClaim)
    const leftover = settledFirst.leftover!
    expect(leftover.voter).toEqual(voteAccount)
    expect(leftover.staker).toEqual(bondsAuthority)
    expect(await provider.connection.getAccountInfo(voteAccount)).toBeNull()
    const siblingBefore = await getSettlement(program, sibling)
    expect(siblingBefore.epochCreatedFor).toEqual(
      first.settlementBefore.epochCreatedFor,
    )

    const second = {
      ...first,
      settlementAccount: sibling,
      settlementBefore: siblingBefore,
      claim: base.maxTotalClaim,
      stakeAccount: first.split,
      before: leftover,
      epoch: await currentEpoch(provider),
      ...(await fund(sibling, first.split)),
    }
    expect(
      splitModel(leftover, base.maxTotalClaim, second.epoch, false).path,
    ).toEqual('split')
    const settledSecond = await settle(second)
    expectFundedShape(second, settledSecond, base.maxTotalClaim)
    expect(settledSecond.logs).not.toContain(CLOSED_VOTE_LOG)
    expect(settledSecond.funded).toEqual(base.maxTotalClaim)
    expect(settledSecond.leftover!.voter).toEqual(voteAccount)
    expect(settledSecond.leftover!.staker).toEqual(bondsAuthority)

    expect(await snapshot(first.stakeAccount)).toEqual(settledFirst.after)
    expect(
      (await getSettlement(program, first.settlementAccount)).lamportsFunded,
    ).toEqual(settledFirst.settlement.lamportsFunded)
    // F3: both fundings keep the bond's lamports, each adds only its split rent
    expect(
      settledFirst.after.lamports +
        settledSecond.after.lamports +
        settledSecond.leftover!.lamports,
    ).toEqual(first.before.lamports + 2 * rent)
  })
  it('snapshot reports no voter for an undelegated stake account', async () => {
    const { stakeAccount } = await createInitializedStakeAccount({ provider })
    const undelegated = (await snapshot(stakeAccount))!
    expect(undelegated.voter).toBeNull()
    expect(undelegated.stake).toEqual(0)
  })
  // TLA+ counterexample (new-withdraw-requests.cfg): the leftover of a withdraw request split stays in the bond
  it('claim withdraw request: the underwater leftover of an inactive bond account is still fully fundable', async () => {
    const stakeAccount = await buildSource({
      state: 'inactive',
      lamports: 13 * SOL,
    })
    const before = (await snapshot(stakeAccount))!
    const amount = 4 * SOL
    const { withdrawRequestAccount } =
      await executeInitWithdrawRequestInstruction({
        program,
        provider,
        bondAccount,
        configAccount,
        validatorIdentity,
        amount,
      })
    const config = await getConfig(program, configAccount)
    warpToEpoch(
      provider,
      (await currentEpoch(provider)) +
        BigInt(config.withdrawLockupEpochs.toString()) +
        1n,
    )
    const user = Keypair.generate().publicKey
    const { instruction, splitStakeAccount } =
      await claimWithdrawRequestInstruction({
        program,
        withdrawRequestAccount,
        bondAccount,
        configAccount,
        voteAccount,
        stakeAccount,
        authority: validatorIdentity,
        withdrawer: user,
      })
    await provider.sendIx([validatorIdentity, splitStakeAccount], instruction)

    const paid = (await snapshot(stakeAccount))!
    const leftover = (await snapshot(splitStakeAccount.publicKey))!
    expect({
      lamports: paid.lamports,
      staker: paid.staker,
      withdrawer: paid.withdrawer,
    }).toEqual({ lamports: amount, staker: user, withdrawer: user })
    // the inactive split clones the full recorded stake into the leftover kept by the bond
    expect({
      lamports: leftover.lamports,
      stake: leftover.stake,
      staker: leftover.staker,
      withdrawer: leftover.withdrawer,
      deactivationEpoch: leftover.deactivationEpoch,
    }).toEqual({
      lamports: before.lamports - amount + rent,
      stake: before.stake,
      staker: bondsAuthority,
      withdrawer: bondsAuthority,
      deactivationEpoch: before.deactivationEpoch,
    })
    expect(leftover.stake).toBeGreaterThan(leftover.lamports - rent)

    const claim = 2 * SOL
    const { settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: await currentEpoch(provider),
      maxTotalClaim: claim,
    })
    const funding = await fund(settlementAccount, splitStakeAccount.publicKey)
    await funding.send()
    const funded = (await snapshot(splitStakeAccount.publicKey))!
    const fundedLeftover = (await snapshot(funding.split))!
    expect(
      (await getSettlement(program, settlementAccount)).lamportsFunded,
    ).toEqual(claim)
    expect(funded.lamports).toEqual(claim + minSize + rent)
    expect({
      lamports: fundedLeftover.lamports,
      stake: fundedLeftover.stake,
      staker: fundedLeftover.staker,
      deactivationEpoch: fundedLeftover.deactivationEpoch,
    }).toEqual({
      lamports: leftover.lamports - claim - minSize,
      stake: leftover.lamports - claim - minSize - rent,
      staker: bondsAuthority,
      deactivationEpoch: BigInt(U64_MAX.toString()),
    })
  })
})
