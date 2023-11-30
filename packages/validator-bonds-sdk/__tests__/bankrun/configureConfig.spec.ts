import {
  Config,
  ValidatorBondsProgram,
  getConfig,
  configureConfigInstruction,
} from '../../src'
import {
  BankrunExtendedProvider,
  bankrunExecute,
  bankrunExecuteIx,
  bankrunTransaction,
  initBankrunTest,
} from './bankrun'
import { ProgramAccount } from '@coral-xyz/anchor'
import { Keypair, PublicKey, Transaction } from '@solana/web3.js'
import { executeInitConfigInstruction } from '../utils/testTransactions'
import { checkAnchorErrorMessage } from '../utils/helpers'

describe('Validator Bonds configure config tests', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configInitialized: ProgramAccount<Config>
  let adminAuthority: Keypair
  let operatorAuthority: Keypair

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;({ provider, program } = await initBankrunTest())
  })

  beforeEach(async () => {
    const {
      configAccount,
      adminAuthority: adminAuth,
      operatorAuthority: operatorAuth,
    } = await executeInitConfigInstruction(program, provider, 1, 2)
    configInitialized = {
      publicKey: configAccount,
      account: await getConfig(program, configAccount),
    }
    expect(configInitialized.account.adminAuthority).toEqual(
      adminAuth.publicKey
    )
    expect(configInitialized.account.epochsToClaimSettlement).toEqual(1)
    expect(configInitialized.account.withdrawLockupEpochs).toEqual(2)
    adminAuthority = adminAuth
    operatorAuthority = operatorAuth
  })

  it('configure config', async () => {
    const newAdminAuthority = Keypair.generate()
    const { instruction } = await configureConfigInstruction({
      program,
      configAccount: configInitialized.publicKey,
      adminAuthority: configInitialized.account.adminAuthority,
      epochsToClaimSettlement: 3,
      admin: newAdminAuthority.publicKey,
    })
    await bankrunExecuteIx(
      provider,
      [provider.wallet, adminAuthority],
      instruction
    )
    const config = await getConfig(program, configInitialized.publicKey)
    expect(config.adminAuthority).toEqual(newAdminAuthority.publicKey)
    expect(config.operatorAuthority).toEqual(
      configInitialized.account.operatorAuthority
    )
    expect(config.epochsToClaimSettlement).toEqual(3)
    expect(config.withdrawLockupEpochs).toEqual(
      configInitialized.account.withdrawLockupEpochs
    )

    const { instruction: instruction2 } = await configureConfigInstruction({
      program,
      configAccount: configInitialized.publicKey,
      epochsToClaimSettlement: 3,
      withdrawLockupEpochs: 4,
      operator: PublicKey.default,
    })
    await bankrunExecuteIx(
      provider,
      [provider.wallet, newAdminAuthority],
      instruction2
    )
    const config2 = await getConfig(program, configInitialized.publicKey)
    expect(config2.adminAuthority).toEqual(newAdminAuthority.publicKey)
    expect(config2.operatorAuthority).toEqual(PublicKey.default)
    expect(config2.epochsToClaimSettlement).toEqual(3)
    expect(config2.withdrawLockupEpochs).toEqual(4)
  })

  it('configure config wrong keys', async () => {
    // wrong admin authority
    const randomKey = Keypair.generate()
    const tx = await getConfigureConfigTx(randomKey.publicKey)
    try {
      await bankrunExecute(provider, [provider.wallet, randomKey], tx)
    } catch (e) {
      checkAnchorErrorMessage(e, 6001, 'requires admin authority')
    }

    // trying to use operator authority
    const txOperator = await getConfigureConfigTx(operatorAuthority.publicKey)
    try {
      await bankrunExecuteIx(
        provider,
        [provider.wallet, operatorAuthority],
        txOperator
      )
    } catch (e) {
      checkAnchorErrorMessage(e, 6001, 'requires admin authority')
    }
  })

  async function getConfigureConfigTx(
    adminAuthority?: PublicKey
  ): Promise<Transaction> {
    const tx = await bankrunTransaction(provider)
    const { instruction } = await configureConfigInstruction({
      program,
      adminAuthority,
      configAccount: configInitialized.publicKey,
      withdrawLockupEpochs: 42,
    })
    tx.add(instruction)
    provider.wallet.signTransaction(tx)
    return tx
  }
})
