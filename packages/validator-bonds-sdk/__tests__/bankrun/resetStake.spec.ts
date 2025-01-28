import {
  Errors,
  ValidatorBondsProgram,
  resetStakeInstruction,
  bondsWithdrawerAuthority,
} from '../../src'
import {
  BankrunExtendedProvider,
  currentEpoch,
} from '@marinade.finance/bankrun-utils'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '../utils/testTransactions'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  StakeStates,
  createBondsFundedStakeAccount,
  createSettlementFundedDelegatedStake,
  createSettlementFundedInitializedStake,
  createVoteAccount,
  getAndCheckStakeAccount,
} from '../utils/staking'
import { verifyError } from '@marinade.finance/anchor-common'
import { initBankrunTest } from './bankrun'
import { U64_MAX } from '@marinade.finance/web3js-common'

describe('Validator Bonds reset stake', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let operatorAuthority: Keypair
  let validatorIdentity: Keypair
  let voteAccount: PublicKey

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
  })

  beforeEach(async () => {
    ;({ configAccount, operatorAuthority } = await executeInitConfigInstruction(
      {
        program,
        provider,
      },
    ))
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
  })

  it('reset settlement stake account', async () => {
    const fakeSettlement = Keypair.generate().publicKey
    const stakeAccount = await createSettlementFundedDelegatedStake({
      program,
      provider,
      configAccount,
      settlementAccount: fakeSettlement,
      voteAccount,
      lamports: LAMPORTS_PER_SOL * 5,
    })

    const { instruction } = await resetStakeInstruction({
      program,
      configAccount,
      stakeAccount,
      voteAccount,
      settlementAccount: fakeSettlement,
    })
    await provider.sendIx([], instruction)

    const epochNow = await currentEpoch(provider)
    const [bondsAuth] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
    )
    const [stakeAccountData] = await getAndCheckStakeAccount(
      provider,
      stakeAccount,
      StakeStates.Delegated,
    )
    expect(stakeAccountData.Stake?.stake.delegation.voterPubkey).toEqual(
      voteAccount,
    )
    expect(stakeAccountData.Stake?.stake.delegation.activationEpoch).toEqual(
      epochNow,
    )
    expect(stakeAccountData.Stake?.stake.delegation.deactivationEpoch).toEqual(
      U64_MAX,
    )
    expect(stakeAccountData.Stake?.meta.authorized.staker).toEqual(bondsAuth)
    expect(stakeAccountData.Stake?.meta.authorized.withdrawer).toEqual(
      bondsAuth,
    )
  })

  it('cannot reset stake when not delegated', async () => {
    const fakeSettlement = Keypair.generate().publicKey
    const stakeAccount = await createSettlementFundedInitializedStake({
      program,
      provider,
      configAccount,
      settlementAccount: fakeSettlement,
      lamports: LAMPORTS_PER_SOL * 2,
    })
    const { instruction } = await resetStakeInstruction({
      program,
      configAccount,
      stakeAccount,
      voteAccount,
      settlementAccount: fakeSettlement,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error('Expected error; stake is not delegated')
    } catch (e) {
      verifyError(e, Errors, 6019, 'not delegated')
    }
  })

  it('cannot reset stake account not funded to a settlement', async () => {
    const fakeSettlement = Keypair.generate().publicKey
    const stakeAccount = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      voteAccount,
      lamports: LAMPORTS_PER_SOL * 5,
    })

    const { instruction } = await resetStakeInstruction({
      program,
      configAccount,
      stakeAccount,
      voteAccount,
      settlementAccount: fakeSettlement,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error(
        'Expected error as stake account is not funded to a settlement',
      )
    } catch (e) {
      verifyError(e, Errors, 6046, 'Stake account staker authority mismatches')
    }
  })

  it('cannot reset with existing settlement', async () => {
    const { settlementAccount } = await executeInitSettlement({
      configAccount: configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: await currentEpoch(provider),
    })
    const stakeAccount = await createSettlementFundedDelegatedStake({
      program,
      provider,
      configAccount,
      settlementAccount: settlementAccount,
      voteAccount,
      lamports: LAMPORTS_PER_SOL * 5,
    })

    const { instruction } = await resetStakeInstruction({
      program,
      configAccount,
      stakeAccount,
      voteAccount,
      settlementAccount,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error('Expected error; settlement account exists')
    } catch (e) {
      verifyError(e, Errors, 6027, 'Settlement has to be closed')
    }
  })
})
