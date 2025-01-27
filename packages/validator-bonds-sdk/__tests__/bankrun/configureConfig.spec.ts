import {
  Config,
  ValidatorBondsProgram,
  getConfig,
  configureConfigInstruction,
  Errors,
} from '../../src'
import {
  BankrunExtendedProvider,
  bankrunExecute,
  bankrunExecuteIx,
  bankrunTransaction,
} from '@marinade.finance/bankrun-utils'
import { ProgramAccount } from '@coral-xyz/anchor'
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
} from '@solana/web3.js'
import {
  executeConfigureConfigInstruction,
  executeInitConfigInstruction,
} from '../utils/testTransactions'
import { verifyError } from '@marinade.finance/anchor-common'
import { initBankrunTest } from './bankrun'

describe('Validator Bonds configure config tests', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configInitialized: ProgramAccount<Config>
  let adminAuthority: Keypair
  let operatorAuthority: Keypair

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
  })

  beforeEach(async () => {
    const {
      configAccount,
      adminAuthority: adminAuth,
      operatorAuthority: operatorAuth,
    } = await executeInitConfigInstruction({
      program,
      provider,
      epochsToClaimSettlement: 1,
      withdrawLockupEpochs: 2,
    })
    configInitialized = {
      publicKey: configAccount,
      account: await getConfig(program, configAccount),
    }
    expect(configInitialized.account.adminAuthority).toEqual(
      adminAuth.publicKey,
    )
    expect(configInitialized.account.epochsToClaimSettlement).toEqual(1)
    expect(configInitialized.account.withdrawLockupEpochs).toEqual(2)
    adminAuthority = adminAuth
    operatorAuthority = operatorAuth
  })

  it('configure config', async () => {
    const newAdminAuthority = Keypair.generate()
    await executeConfigureConfigInstruction({
      program,
      provider,
      configAccount: configInitialized.publicKey,
      adminAuthority,
      newAdmin: newAdminAuthority.publicKey,
      newEpochsToClaimSettlement: 3,
      newSlotsToStartSettlementClaiming: 10,
      newMinBondMaxStakeWanted: LAMPORTS_PER_SOL * 10_000,
    })
    const config = await getConfig(program, configInitialized.publicKey)
    expect(config.adminAuthority).toEqual(newAdminAuthority.publicKey)
    expect(config.operatorAuthority).toEqual(
      configInitialized.account.operatorAuthority,
    )
    expect(config.epochsToClaimSettlement).toEqual(3)
    expect(config.slotsToStartSettlementClaiming).toEqual(10)
    expect(config.withdrawLockupEpochs).toEqual(
      configInitialized.account.withdrawLockupEpochs,
    )
    expect(config.minBondMaxStakeWanted).toEqual(LAMPORTS_PER_SOL * 10_000)

    const pauseAuthority = PublicKey.unique()
    const { instruction: instruction2 } = await configureConfigInstruction({
      program,
      configAccount: configInitialized.publicKey,
      newEpochsToClaimSettlement: 3,
      newWithdrawLockupEpochs: 4,
      newOperator: PublicKey.default,
      newPauseAuthority: pauseAuthority,
    })
    await bankrunExecuteIx(
      provider,
      [provider.wallet, newAdminAuthority],
      instruction2,
    )
    const config2 = await getConfig(program, configInitialized.publicKey)
    expect(config2.adminAuthority).toEqual(newAdminAuthority.publicKey)
    expect(config2.operatorAuthority).toEqual(PublicKey.default)
    expect(config2.pauseAuthority).toEqual(pauseAuthority)
    expect(config2.paused).toBeFalsy()
    expect(config2.epochsToClaimSettlement).toEqual(3)
    expect(config2.slotsToStartSettlementClaiming).toEqual(10)
    expect(config2.withdrawLockupEpochs).toEqual(4)
    expect(config.minBondMaxStakeWanted).toEqual(LAMPORTS_PER_SOL * 10_000)
  })

  it('configure config wrong keys', async () => {
    // wrong admin authority
    const randomKey = Keypair.generate()
    const tx = await getConfigureConfigTx(randomKey.publicKey)
    try {
      await bankrunExecute(provider, [provider.wallet, randomKey], tx)
      throw new Error('failure expected as wrong admin')
    } catch (e) {
      verifyError(e, Errors, 6001, 'requires admin authority')
    }

    // trying to use operator authority
    const txOperator = await getConfigureConfigTx(operatorAuthority.publicKey)
    try {
      await bankrunExecuteIx(
        provider,
        [provider.wallet, operatorAuthority],
        txOperator,
      )
      throw new Error('failure expected as wrong admin')
    } catch (e) {
      verifyError(e, Errors, 6001, 'requires admin authority')
    }
  })

  async function getConfigureConfigTx(
    adminAuthority?: PublicKey,
  ): Promise<Transaction> {
    const tx = await bankrunTransaction(provider)
    const { instruction } = await configureConfigInstruction({
      program,
      adminAuthority,
      configAccount: configInitialized.publicKey,
      newWithdrawLockupEpochs: 42,
    })
    tx.add(instruction)
    await provider.wallet.signTransaction(tx)
    return tx
  }
})
