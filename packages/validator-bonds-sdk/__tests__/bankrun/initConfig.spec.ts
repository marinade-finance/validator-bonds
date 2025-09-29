import assert from 'assert'

import { Keypair } from '@solana/web3.js'

import { initBankrunTest } from './bankrun'
import { getConfig, initConfigInstruction } from '../../src'
import { executeInitConfigInstruction } from '../utils/testTransactions'

import type { ValidatorBondsProgram } from '../../src'
import type { BankrunExtendedProvider } from '@marinade.finance/bankrun-utils'

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
        slotsToStartSettlementClaiming: 3,
      })

    const configData = await getConfig(program, configAccount)
    expect(configData.adminAuthority).toEqual(adminAuthority.publicKey)
    expect(configData.operatorAuthority).toEqual(operatorAuthority.publicKey)
    expect(configData.epochsToClaimSettlement).toEqual(1)
    expect(configData.withdrawLockupEpochs).toEqual(2)
    expect(configData.slotsToStartSettlementClaiming).toEqual(3)

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
    assert(
      configAccount.toBase58() === configAccountKeypair.publicKey.toBase58(),
    )
    assert((await provider.connection.getAccountInfo(configAccount)) != null)

    try {
      const { instruction } = await initConfigInstruction({
        program,
        configAccount: configAccountKeypair,
        admin: adminAuthority.publicKey,
        operator: operatorAuthority.publicKey,
        epochsToClaimSettlement: 1,
        withdrawLockupEpochs: 1,
        slotsToStartSettlementClaiming: 1,
      })
      await provider.sendIx([configAccountKeypair], instruction)
      throw new Error('Should have failed as bond already exists')
    } catch (e) {
      if (!(e as Error).message.includes('custom program error: 0x0')) {
        console.error(
          `Expected failure as config account ${configAccount.toBase58()} should already exist`,
        )
        throw e
      }
    }
  })
})
