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
  authorizeStakeAccount,
  createVoteAccount,
  delegatedStakeAccount,
  getAndCheckStakeAccount,
} from '../utils/staking'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '../utils/testTransactions'

import type { LiteSvmProvider } from './litesvm'
import type { ValidatorBondsProgram } from '../../src'
import type { PublicKey } from '@solana/web3.js'

const SOL = LAMPORTS_PER_SOL
const PINNED_RESERVE = STAKE_ACCOUNT_PSEUDO_RENT_EXEMPT_RESERVE

type SourceState =
  'activating' | 'active' | 'deactivating' | 'inactive' | 'inactiveUnderwater'

// sizes that depend on rent, the config and the remaining claim
type Size =
  | 'amountNeeded'
  | 'splitThresholdMinus1'
  | 'splitThreshold'
  | 'minimumDelegation'
  | 'minSizeMinus1'
  | 'minSize'
  | 'minSizePlus1'

type Source = {
  state: SourceState
  // lamports the stake account is created and delegated with
  lamports: number | Size
  // lamports transferred on top after delegation, never delegated
  surplus?: number
  // lamports withdrawn once inactive, leaving the account below its recorded stake
  withdraw?: number
}

type Path =
  | 'whole'
  | 'split'
  | 'splitWithdraw'
  | 'splitInitialize'
  | 'splitInactiveClone'
  | 'noop'
  | { error: number; message: string }
  | { panic: number }

type Guard = 'voter' | 'staker' | 'withdrawer' | 'lockup'

type Case = {
  name: string
  maxTotalClaim: number
  // an active account of these lamports funds the settlement first (whole-account path)
  preFund?: number
  source: Source
  guard?: Guard
  path: Path
  // KNOWN_DEVIATION: current behaviour breaks this invariant; the funding fix flips the case
  knownDeviation?: 'F1' | 'F5'
  // also claim the whole settlement, close it and reset the funded account
  lifecycle?: true
}

type StakeSnapshot = {
  lamports: number
  stake: number
  activationEpoch: bigint
  deactivationEpoch: bigint
  voter: PublicKey
  staker: PublicKey
  withdrawer: PublicKey
}

describe('Validator Bonds fund settlement matrix', () => {
  let provider: LiteSvmProvider
  let program: ValidatorBondsProgram
  let rent: number
  let minSize: number
  let configAccount: PublicKey
  let operatorAuthority: Keypair
  let voteAccount: PublicKey
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
    let validatorIdentity: Keypair | undefined
    ;({ voteAccount, validatorIdentity } = await createVoteAccount({
      provider,
    }))
    await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount,
      validatorIdentity,
    })
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
      voter: delegation?.voterPubkey ?? voteAccount,
      staker: meta.authorized.staker,
      withdrawer: meta.authorized.withdrawer,
    }
  }

  async function buildSource(
    source: Source & { lamports: number },
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
      case 'inactive':
        await warpToNextEpoch(provider)
        await deactivate()
        await warpToNextEpoch(provider)
        break
      case 'inactiveUnderwater':
        // deactivated in its activation epoch, so inactive at once with the full recorded stake
        await deactivate()
        await provider.sendIx(
          [withdrawer],
          StakeProgram.withdraw({
            stakePubkey: stakeAccount,
            authorizedPubkey: withdrawer.publicKey,
            toPubkey: provider.walletPubkey,
            lamports: source.withdraw ?? 0,
          }),
        )
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
      name: 'inactive, below the claim: whole account',
      maxTotalClaim: 10 * SOL,
      source: { state: 'inactive', lamports: 5 * SOL },
      path: 'whole',
    },
    {
      name: 'inactive, above the claim: split clones the full recorded stake into the leftover',
      lifecycle: true,
      maxTotalClaim: 10 * SOL,
      source: { state: 'inactive', lamports: 50 * SOL },
      path: 'splitInactiveClone',
      knownDeviation: 'F5',
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
      name: 'inactive underwater, above the claim: panics on lamports - delegation.stake',
      maxTotalClaim: 10 * SOL,
      source: {
        state: 'inactiveUnderwater',
        lamports: 50 * SOL,
        withdraw: 20 * SOL,
      },
      path: { panic: 233 },
      knownDeviation: 'F1',
    },
    // rent gap window: live minimum <= lamports < minimal size counted with the pinned reserve
    {
      name: 'rent gap, live minimum (1 SOL + live rent): panics on lamports - min_size',
      maxTotalClaim: 10 * SOL,
      source: { state: 'active', lamports: 'minimumDelegation' },
      path: { panic: 200 },
      knownDeviation: 'F1',
    },
    {
      name: 'rent gap, minimal size - 1 lamport: panics on lamports - min_size',
      maxTotalClaim: 10 * SOL,
      source: { state: 'active', lamports: 'minSizeMinus1' },
      path: { panic: 200 },
      knownDeviation: 'F1',
    },
    {
      name: 'exactly the minimal size: whole account funds 0 lamports (step 4 rejects it, error 6083)',
      maxTotalClaim: 10 * SOL,
      source: { state: 'active', lamports: 'minSize' },
      path: 'whole',
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
      { ...c.source, lamports: resolveLamports(c.source.lamports, claim) },
      c.guard,
      settlementAccount,
    )
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
    const { innerInstructions } = await prepared.send()
    const settlement = await getSettlement(program, prepared.settlementAccount)
    return {
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
    const error = /Error Number: (\d+)\. Error Message: ([^\n]*)/.exec(logs)
    return error
      ? { error: Number(error[1]), message: error[2]! }
      : { error: -1, message: logs }
  }

  // the split path the program model predicts for this source and claim
  function splitModel(before: StakeSnapshot, claim: number, epoch: bigint) {
    const leftoverLamports = before.lamports - (claim + minSize) - rent
    const nonDelegated = before.lamports - before.stake
    const maxNonDelegated = claim + PINNED_RESERVE
    const withdrawn =
      nonDelegated > maxNonDelegated ? nonDelegated - maxNonDelegated : 0
    const inactive = before.deactivationEpoch < epoch
    const path: Path = inactive
      ? 'splitInactiveClone'
      : withdrawn === 0
        ? 'split'
        : withdrawn < leftoverLamports
          ? 'splitWithdraw'
          : 'splitInitialize'
    const splitMoved = leftoverLamports - Math.min(withdrawn, leftoverLamports)
    const initialized = path === 'splitInitialize'
    return {
      path,
      leftoverLamports,
      sourceStake:
        inactive || initialized ? before.stake : before.stake - splitMoved,
      leftoverStake: inactive
        ? before.stake
        : initialized
          ? leftoverLamports
          : splitMoved,
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
    ).toBeLessThan(minSize + rent)
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
    const settled = await settle(prepared)
    expectFundedShape(prepared, settled, c.maxTotalClaim)
    const { before } = prepared
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
    const model = splitModel(prepared.before, prepared.claim, prepared.epoch)
    expect(model.path).toEqual(c.path)
    const settled = await settle(prepared)
    expectFundedShape(prepared, settled, c.maxTotalClaim)
    const { before, claim, payer } = prepared
    const { after, settlement } = settled
    const leftover = settled.leftover!
    expect(settled.funded).toEqual(claim)
    expect(settlement.splitRentCollector).toEqual(payer.publicKey)
    expect(settlement.splitRentAmount).toEqual(rent)
    expect(settled.payerLamports).toEqual(SOL - rent)
    expect(after.lamports).toEqual(claim + minSize + rent)
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
    expect(leftover.stake <= leftover.lamports - rent).toBe(
      c.knownDeviation !== 'F5',
    )
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
    ).toBe(c.knownDeviation !== 'F5')
    // L1: bond custody lost exactly the claim
    expect(reset.lamports + (leftover?.lamports ?? 0)).toEqual(
      before.lamports - c.maxTotalClaim,
    )
  })
})
