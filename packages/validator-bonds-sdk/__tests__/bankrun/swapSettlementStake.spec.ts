import { verifyError } from '@marinade.finance/anchor-common'
import { currentEpoch } from '@marinade.finance/bankrun-utils'
import { signer } from '@marinade.finance/web3js-1x'
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js'

import { initBankrunTest, delegateAndFund } from './bankrun'
import {
  Errors,
  bondsWithdrawerAuthority,
  fundSettlementInstruction,
  settlementStakerAuthority,
  swapSettlementStakeInstruction,
} from '../../src'
import {
  StakeStates,
  createDelegatedStakeAccount,
  createInitializedStakeAccount,
  createVoteAccount,
  getAndCheckStakeAccount,
} from '../utils/staking'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '../utils/testTransactions'

import type { ValidatorBondsProgram } from '../../src'
import type { BankrunExtendedProvider } from '@marinade.finance/bankrun-utils'
import type { PublicKey } from '@solana/web3.js'

// SwapSettlementStake: atomically swap a settlement's delegated stake for a
// user-provided undelegated one of equal value, so the settlement becomes
// immediately claimable while the validator's delegation moves to the user.
describe('Validator Bonds swap settlement stake', () => {
  const epochsToClaimSettlement = 3
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let operatorAuthority: Keypair
  let validatorIdentity: Keypair
  let bondAccount: PublicKey
  let voteAccount: PublicKey
  let bondAuth: PublicKey
  let settlementAccount: PublicKey
  let settlementAuth: PublicKey
  let settlementStake: PublicKey
  // the settlement-owned, delegated stake's lamports — what the user must match
  let settlementStakeLamports: number

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
  })

  beforeEach(async () => {
    ;({ configAccount, operatorAuthority } = await executeInitConfigInstruction(
      {
        program,
        provider,
        epochsToClaimSettlement,
      },
    ))
    ;({ voteAccount, validatorIdentity } = await createVoteAccount({
      provider,
    }))
    ;({ bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount,
      validatorIdentity,
    }))
    ;[bondAuth] = bondsWithdrawerAuthority(configAccount, program.programId)

    // fund a settlement with a delegated bond stake -> that becomes settlementStake
    const maxTotalClaim = 2 * LAMPORTS_PER_SOL
    ;({ stakeAccount: settlementStake } = await delegateAndFund({
      program,
      provider,
      voteAccount,
      bondAccount,
      lamports: maxTotalClaim,
    }))
    ;({ settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: await currentEpoch(provider),
      maxTotalClaim,
    }))
    ;[settlementAuth] = settlementStakerAuthority(
      settlementAccount,
      program.programId,
    )
    const { instruction: fundIx, splitStakeAccount } =
      await fundSettlementInstruction({
        program,
        settlementAccount,
        stakeAccount: settlementStake,
      })
    await provider.sendIx(
      [signer(splitStakeAccount), operatorAuthority],
      fundIx,
    )
    settlementStakeLamports = (await provider.connection.getAccountInfo(
      settlementStake,
    ))!.lamports
  })

  it('swaps the settlement delegated stake for a user undelegated stake', async () => {
    const userAuthority = Keypair.generate()
    const { stakeAccount: userStake } = await createInitializedStakeAccount({
      provider,
      rentExempt: settlementStakeLamports,
      staker: userAuthority,
      withdrawer: userAuthority,
    })

    const { instruction } = await swapSettlementStakeInstruction({
      program,
      settlementAccount,
      settlementStake,
      userStake,
      userAuthority,
    })
    await provider.sendIx([userAuthority], instruction)

    // the settlement's (delegated) stake now belongs to the user
    const [settlementStakeState] = await getAndCheckStakeAccount(
      provider,
      settlementStake,
      StakeStates.Delegated,
    )
    expect(settlementStakeState.Stake!.meta.authorized.staker).toEqual(
      userAuthority.publicKey,
    )
    expect(settlementStakeState.Stake!.meta.authorized.withdrawer).toEqual(
      userAuthority.publicKey,
    )

    // the user's stake now belongs to the settlement, delegated to the validator
    // and deactivated this epoch: claimable now (effective 0) and reaps to the
    // bond at close (ResetStake, because it is a delegated stake of the validator)
    const [userStakeState] = await getAndCheckStakeAccount(
      provider,
      userStake,
      StakeStates.Delegated,
    )
    expect(userStakeState.Stake!.meta.authorized.staker).toEqual(settlementAuth)
    expect(userStakeState.Stake!.meta.authorized.withdrawer).toEqual(bondAuth)
    expect(userStakeState.Stake!.stake.delegation.voterPubkey).toEqual(
      voteAccount,
    )
    expect(userStakeState.Stake!.stake.delegation.deactivationEpoch).toEqual(
      await currentEpoch(provider),
    )
  })

  it('cannot swap in a delegated user stake', async () => {
    const userAuthority = Keypair.generate()
    const userStake = await createDelegatedStakeAccount({
      provider,
      lamports: settlementStakeLamports,
      voteAccount,
      staker: userAuthority.publicKey,
      withdrawer: userAuthority.publicKey,
    })
    const { instruction } = await swapSettlementStakeInstruction({
      program,
      settlementAccount,
      settlementStake,
      userStake,
      userAuthority,
    })
    try {
      await provider.sendIx([userAuthority], instruction)
      throw new Error('should have failed: user stake is delegated')
    } catch (e) {
      verifyError(e, Errors, 6079, 'must not be delegated')
    }
  })

  it('cannot swap stakes of unequal value', async () => {
    const userAuthority = Keypair.generate()
    const { stakeAccount: userStake } = await createInitializedStakeAccount({
      provider,
      rentExempt: settlementStakeLamports + LAMPORTS_PER_SOL,
      staker: userAuthority,
      withdrawer: userAuthority,
    })
    const { instruction } = await swapSettlementStakeInstruction({
      program,
      settlementAccount,
      settlementStake,
      userStake,
      userAuthority,
    })
    try {
      await provider.sendIx([userAuthority], instruction)
      throw new Error('should have failed: unequal lamports')
    } catch (e) {
      verifyError(e, Errors, 6080, 'equal lamports')
    }
  })
})
