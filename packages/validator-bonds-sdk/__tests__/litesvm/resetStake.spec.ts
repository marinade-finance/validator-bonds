import { U64_MAX } from '@marinade.finance/web3js-1x'
import { Keypair, LAMPORTS_PER_SOL, StakeProgram } from '@solana/web3.js'

import {
  currentEpoch,
  executeIx,
  initLiteSvmTest,
  warpToNextEpoch,
} from './litesvm'
import {
  bondsWithdrawerAuthority,
  getRentExemptStake,
  resetStakeInstruction,
  settlementStakerAuthority,
} from '../../src'
import {
  CLOSED_VOTE_VARIANTS,
  LIVE_VOTE_VARIANTS,
  authorizeStakeAccount,
  createVoteAccount,
  delegatedStakeAccount,
  getAndCheckStakeAccount,
  setVoteAccountVariant,
} from '../utils/staking'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '../utils/testTransactions'

import type { LiteSvmProvider } from './litesvm'
import type { ValidatorBondsProgram } from '../../src'
import type { VoteAccountVariant } from '../utils/staking'
import type { PublicKey } from '@solana/web3.js'

type StakeState = 'active' | 'deactivating' | 'inactive'

const SKIP_NOT_DEACTIVATED = 'is not deactivated, skipping delegation'
const SKIP_CLOSED_VOTE = 'cannot be delegated to, skipping delegation'

describe('Validator Bonds reset stake under vote account variants', () => {
  let provider: LiteSvmProvider
  let program: ValidatorBondsProgram
  let rent: number
  let configAccount: PublicKey
  let voteKeypair: Keypair
  let authorizedWithdrawer: Keypair
  let bondsAuthority: PublicKey

  beforeAll(async () => {
    ;({ provider, program } = initLiteSvmTest())
    rent = await getRentExemptStake(provider)
  })

  beforeEach(async () => {
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
    }))
    voteKeypair = Keypair.generate()
    const created = await createVoteAccount({
      provider,
      voteAccount: voteKeypair,
    })
    authorizedWithdrawer = created.authorizedWithdrawer
    await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount: voteKeypair.publicKey,
      validatorIdentity: created.validatorIdentity,
    })
    ;[bondsAuthority] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
    )
  })

  async function delegation(stakeAccount: PublicKey) {
    const [state, info] = await getAndCheckStakeAccount(provider, stakeAccount)
    const d = state.Stake!.stake.delegation
    return {
      lamports: info.lamports,
      staker: state.Stake!.meta.authorized.staker,
      withdrawer: state.Stake!.meta.authorized.withdrawer,
      voter: d.voterPubkey,
      stake: d.stake.toString(),
      activationEpoch: d.activationEpoch.toString(),
      deactivationEpoch: d.deactivationEpoch.toString(),
    }
  }

  // a stake account funded to the settlement, delegated while the vote account is live
  async function fundedStake(state: StakeState, settlementAccount: PublicKey) {
    const { stakeAccount, staker, withdrawer } = await delegatedStakeAccount({
      provider,
      voteAccountToDelegate: voteKeypair.publicKey,
      lamports: 5 * LAMPORTS_PER_SOL,
    })
    await warpToNextEpoch(provider)
    if (state !== 'active') {
      await provider.sendIx(
        [staker],
        StakeProgram.deactivate({
          stakePubkey: stakeAccount,
          authorizedPubkey: staker.publicKey,
        }),
      )
    }
    if (state === 'inactive') {
      await warpToNextEpoch(provider)
      await warpToNextEpoch(provider)
    }
    await authorizeStakeAccount({
      provider,
      stakeAccount,
      authority: withdrawer,
      staker: settlementStakerAuthority(
        settlementAccount,
        program.programId,
      )[0],
      withdrawer: bondsAuthority,
    })
    return stakeAccount
  }

  async function reset(stakeAccount: PublicKey, settlementAccount: PublicKey) {
    const { instruction } = await resetStakeInstruction({
      program,
      configAccount,
      stakeAccount,
      voteAccount: voteKeypair.publicKey,
      settlementAccount,
    })
    return (await executeIx(provider, [provider.wallet], instruction))
      .logMessages
  }

  const ALL_VARIANTS = [...LIVE_VOTE_VARIANTS, ...CLOSED_VOTE_VARIANTS]
  const STATES: StakeState[] = ['active', 'deactivating', 'inactive']
  const CASES = STATES.flatMap(state =>
    ALL_VARIANTS.map(vote => ({ state, vote })),
  )

  it.each<{ state: StakeState; vote: VoteAccountVariant }>(CASES)(
    '$state stake, vote account $vote',
    async ({ state, vote }) => {
      const fakeSettlement = Keypair.generate().publicKey
      const stakeAccount = await fundedStake(state, fakeSettlement)
      await setVoteAccountVariant({
        provider,
        voteAccount: voteKeypair,
        authorizedWithdrawer,
        variant: vote,
      })
      const before = await delegation(stakeAccount)
      const logs = (await reset(stakeAccount, fakeSettlement)).join('\n')
      const after = await delegation(stakeAccount)

      expect({
        staker: after.staker,
        withdrawer: after.withdrawer,
        voter: after.voter,
        lamports: after.lamports,
      }).toEqual({
        staker: bondsAuthority,
        withdrawer: bondsAuthority,
        voter: voteKeypair.publicKey,
        lamports: before.lamports,
      })
      const live = LIVE_VOTE_VARIANTS.includes(vote)
      const returned = { ...before, staker: bondsAuthority }
      const expected =
        state === 'active' || !live
          ? returned
          : state === 'deactivating'
            ? // the stake program rescinds a deactivation in its own epoch
              { ...returned, deactivationEpoch: U64_MAX.toString() }
            : {
                ...returned,
                stake: (before.lamports - rent).toString(),
                activationEpoch: (await currentEpoch(provider)).toString(),
                deactivationEpoch: U64_MAX.toString(),
              }
      expect(after).toEqual(expected)
      expect({
        skippedNotDeactivated: logs.includes(SKIP_NOT_DEACTIVATED),
        skippedClosedVote: logs.includes(SKIP_CLOSED_VOTE),
      }).toEqual({
        skippedNotDeactivated: state === 'active',
        skippedClosedVote: state !== 'active' && !live,
      })
    },
  )

  it('fails while the settlement exists', async () => {
    // any existing account stands for an open settlement: reset requires it to be closed
    const stakeAccount = await fundedStake('inactive', configAccount)
    const before = await delegation(stakeAccount)
    const failure = await reset(stakeAccount, configAccount).then(
      () => undefined,
      (e: unknown) => ((e as { logs?: string[] }).logs ?? []).join('\n'),
    )
    expect(failure).toContain('SettlementNotClosed')
    expect(await delegation(stakeAccount)).toEqual(before)
  })
})
