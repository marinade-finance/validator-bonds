import {
  Errors,
  ValidatorBondsProgram,
  resetStakeInstruction,
  withdrawStakeInstruction,
} from '../../src'
import {
  BankrunExtendedProvider,
  assertNotExist,
  currentEpoch,
} from '@marinade.finance/bankrun-utils'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '../utils/testTransactions'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  createBondsFundedStakeAccount,
  createSettlementFundedDelegatedStake,
  createSettlementFundedInitializedStake,
  createVoteAccount,
} from '../utils/staking'
import { verifyError } from '@marinade.finance/anchor-common'
import {
  SignerType,
  createUserAndFund,
  signer,
} from '@marinade.finance/web3js-common'
import { initBankrunTest } from './bankrun'

describe('Validator Bonds withdraw stake', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let operatorAuthority: Keypair
  let validatorIdentity: Keypair
  let voteAccount: PublicKey
  let user: SignerType

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
  })

  beforeEach(async () => {
    ;({ configAccount, operatorAuthority } = await executeInitConfigInstruction(
      {
        program,
        provider,
      }
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
    user = signer(
      await createUserAndFund({ provider, lamports: LAMPORTS_PER_SOL })
    )
  })

  it('withdraw settlement operator stake account', async () => {
    const fakeSettlement = Keypair.generate().publicKey
    const stakeAccount = await createSettlementFundedInitializedStake({
      program,
      provider,
      configAccount,
      settlementAccount: fakeSettlement,
      lamports: LAMPORTS_PER_SOL,
    })
    const { instruction } = await withdrawStakeInstruction({
      program,
      configAccount,
      stakeAccount,
      operatorAuthority: operatorAuthority.publicKey,
      settlementAccount: fakeSettlement,
      withdrawTo: user.publicKey,
    })
    await provider.sendIx([operatorAuthority], instruction)
    await assertNotExist(provider, stakeAccount)
    expect(
      (await provider.connection.getAccountInfo(user.publicKey))?.lamports
    ).toEqual(2 * LAMPORTS_PER_SOL)
  })

  it('cannot withdraw settlement operator stake when delegated', async () => {
    const fakeSettlement = Keypair.generate().publicKey
    const stakeAccount = await createSettlementFundedDelegatedStake({
      program,
      provider,
      configAccount,
      settlementAccount: fakeSettlement,
      lamports: LAMPORTS_PER_SOL * 2,
      voteAccount,
    })
    const { instruction } = await withdrawStakeInstruction({
      program,
      configAccount,
      stakeAccount,
      operatorAuthority: operatorAuthority.publicKey,
      settlementAccount: fakeSettlement,
      withdrawTo: user.publicKey,
    })
    try {
      await provider.sendIx([operatorAuthority], instruction)
      throw new Error('Expected error; stake is delegated')
    } catch (e) {
      verifyError(e, Errors, 6057, 'Wrong state')
    }
    expect(
      provider.connection.getAccountInfo(stakeAccount)
    ).resolves.not.toBeNull()
    expect(
      (await provider.connection.getAccountInfo(user.publicKey))?.lamports
    ).toEqual(LAMPORTS_PER_SOL)
  })

  it('cannot withdraw stake account not funded to a settlement', async () => {
    const fakeSettlement = Keypair.generate().publicKey
    const stakeAccount = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount: configAccount,
      voteAccount,
      lamports: LAMPORTS_PER_SOL * 5,
    })

    const { instruction } = await resetStakeInstruction({
      program,
      configAccount: configAccount,
      stakeAccount,
      voteAccount,
      settlementAccount: fakeSettlement,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error(
        'Expected error as stake account is not funded to a settlement'
      )
    } catch (e) {
      verifyError(e, Errors, 6046, 'Stake account staker authority mismatches')
    }
  })

  it('cannot withdraw with existing settlement', async () => {
    const { settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: await currentEpoch(provider),
    })
    const stakeAccount = await createSettlementFundedInitializedStake({
      program,
      provider,
      configAccount: configAccount,
      settlementAccount: settlementAccount,
      lamports: LAMPORTS_PER_SOL * 5,
    })

    const { instruction } = await withdrawStakeInstruction({
      program,
      configAccount: configAccount,
      stakeAccount,
      settlementAccount,
      operatorAuthority: operatorAuthority.publicKey,
      withdrawTo: user.publicKey,
    })
    try {
      await provider.sendIx([operatorAuthority], instruction)
      throw new Error('Expected error; settlement account exists')
    } catch (e) {
      verifyError(e, Errors, 6027, 'Settlement has to be closed')
    }
  })
})
