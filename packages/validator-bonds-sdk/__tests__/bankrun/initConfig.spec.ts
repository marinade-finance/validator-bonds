import {
  ValidatorBondsProgram,
  getConfig,
  initConfigInstruction,
} from '../../src'
import { BankrunExtendedProvider } from '@marinade.finance/bankrun-utils'
import { executeInitConfigInstruction } from '../utils/testTransactions'
import { Keypair } from '@solana/web3.js'
import { initBankrunTest } from './bankrun'

describe('Validator Bonds config account tests', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
  })

  it('init config', async () => {
    const { configAccount, adminAuthority, operatorAuthority } =
      await executeInitConfigInstruction({
        program,
        provider,
        epochsToClaimSettlement: 1,
        withdrawLockupEpochs: 2,
      })

    const configData = await getConfig(program, configAccount)
    expect(configData.adminAuthority).toEqual(adminAuthority.publicKey)
    expect(configData.operatorAuthority).toEqual(operatorAuthority.publicKey)
    expect(configData.epochsToClaimSettlement).toEqual(1)
    expect(configData.withdrawLockupEpochs).toEqual(2)

    const configAccountInfo =
      await provider.connection.getAccountInfo(configAccount)
    // NO change of account size from the first deployment on mainnet
    // account size is 609 bytes and aligned to 8 bytes alignment
    expect(configAccountInfo?.data.byteLength).toEqual(616)
    console.log('config account length', configAccountInfo?.data.byteLength)
  })

  it('cannot init config when already exists', async () => {
    const configAccountKeypair = Keypair.generate()
    const { configAccount, adminAuthority, operatorAuthority } =
      await executeInitConfigInstruction({
        program,
        provider,
        configAccountKeypair,
      })
    expect(configAccount).toEqual(configAccountKeypair.publicKey)
    expect(
      provider.connection.getAccountInfo(configAccount)
    ).resolves.not.toBeNull()

    try {
      const { instruction } = await initConfigInstruction({
        program,
        configAccount: configAccountKeypair,
        admin: adminAuthority.publicKey,
        operator: operatorAuthority.publicKey,
        epochsToClaimSettlement: 1,
        withdrawLockupEpochs: 1,
      })
      await provider.sendIx([configAccountKeypair], instruction)
      throw new Error('Should have failed as bond already exists')
    } catch (e) {
      if (!(e as Error).message.includes('custom program error: 0x0')) {
        console.error(
          `Expected failure as config account ${configAccount} should already exist`
        )
        throw e
      }
    }
  })
})
