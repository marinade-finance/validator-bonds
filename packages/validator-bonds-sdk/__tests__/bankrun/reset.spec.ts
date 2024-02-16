import {
  Config,
  Errors,
  U64_MAX,
  ValidatorBondsProgram,
  getConfig,
  resetInstruction,
  withdrawerAuthority,
} from '../../src'
import {
  BankrunExtendedProvider,
  currentEpoch,
  initBankrunTest,
} from './bankrun'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '../utils/testTransactions'
import { ProgramAccount } from '@coral-xyz/anchor'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  StakeStates,
  createBondsFundedStakeAccount,
  createSettlementFundedStakeAccount,
  createVoteAccount,
  getAndCheckStakeAccount,
} from '../utils/staking'
import { verifyError } from '@marinade.finance/anchor-common'

describe('Validator Bonds reset', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let config: ProgramAccount<Config>
  let operatorAuthority: Keypair
  let validatorIdentity: Keypair
  let voteAccount: PublicKey

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
  })

  beforeEach(async () => {
    const { configAccount, operatorAuthority: operatorAuth } =
      await executeInitConfigInstruction({
        program,
        provider,
      })
    config = {
      publicKey: configAccount,
      account: await getConfig(program, configAccount),
    }
    operatorAuthority = operatorAuth
    ;({ voteAccount, validatorIdentity } = await createVoteAccount({
      provider,
    }))
    await executeInitBondInstruction({
      program,
      provider,
      config: config.publicKey,
      voteAccount,
      validatorIdentity,
    })
  })

  it('reset settlement stake account', async () => {
    const fakeSettlement = Keypair.generate().publicKey
    const stakeAccount = await createSettlementFundedStakeAccount({
      program,
      provider,
      configAccount: config.publicKey,
      settlementAccount: fakeSettlement,
      voteAccount,
      lamports: LAMPORTS_PER_SOL * 5,
    })

    const { instruction } = await resetInstruction({
      program,
      configAccount: config.publicKey,
      stakeAccount,
      voteAccount,
      settlementAccount: fakeSettlement,
    })
    await provider.sendIx([], instruction)

    const epochNow = await currentEpoch(provider)
    const [bondsAuth] = withdrawerAuthority(config.publicKey, program.programId)
    const [stakeAccountData] = await getAndCheckStakeAccount(
      provider,
      stakeAccount,
      StakeStates.Delegated
    )
    expect(stakeAccountData.Stake?.stake.delegation.voterPubkey).toEqual(
      voteAccount
    )
    expect(stakeAccountData.Stake?.stake.delegation.activationEpoch).toEqual(
      epochNow
    )
    expect(stakeAccountData.Stake?.stake.delegation.deactivationEpoch).toEqual(
      U64_MAX
    )
    expect(stakeAccountData.Stake?.meta.authorized.staker).toEqual(bondsAuth)
    expect(stakeAccountData.Stake?.meta.authorized.withdrawer).toEqual(
      bondsAuth
    )
  })

  it('cannot reset stake account not funded to a settlement', async () => {
    const fakeSettlement = Keypair.generate().publicKey
    const stakeAccount = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount: config.publicKey,
      voteAccount,
      lamports: LAMPORTS_PER_SOL * 5,
    })

    const { instruction } = await resetInstruction({
      program,
      configAccount: config.publicKey,
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

  it('cannot reset with existing settlement', async () => {
    const { settlementAccount } = await executeInitSettlement({
      config: config.publicKey,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: await currentEpoch(provider),
    })
    const stakeAccount = await createSettlementFundedStakeAccount({
      program,
      provider,
      configAccount: config.publicKey,
      settlementAccount: settlementAccount,
      voteAccount,
      lamports: LAMPORTS_PER_SOL * 5,
    })

    const { instruction } = await resetInstruction({
      program,
      configAccount: config.publicKey,
      stakeAccount,
      voteAccount,
      settlementAccount,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error('Expected error; settlement account exists')
    } catch (e) {
      verifyError(e, Errors, 6027, 'settlement to be closed')
    }
  })
})
