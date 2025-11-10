import { verifyError } from '@marinade.finance/anchor-common'
import { Keypair } from '@solana/web3.js'

import { initBankrunTest } from './bankrun'
import {
  Errors,
  getBondProduct,
  configureCommissionProductInstruction,
  configureCustomProductInstruction,
  parseCommissionData,
  parseCustomData,
  MAX_BPS,
} from '../../src'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitCommissionProductInstruction,
  executeInitCustomProductInstruction,
  executeConfigureCommissionProductInstruction,
  executeConfigureCustomProductInstruction,
} from '../utils/testTransactions'

import type { ValidatorBondsProgram, BondProduct } from '../../src'
import type { ProgramAccount } from '@coral-xyz/anchor'
import type { BankrunExtendedProvider } from '@marinade.finance/bankrun-utils'
import type { PublicKey } from '@solana/web3.js'

type ConfigureCommissionParams = Parameters<
  typeof executeConfigureCommissionProductInstruction
>[0]

describe('Validator Bonds configure bond product account', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let bondAccount: PublicKey
  let bondAuthority: Keypair
  let validatorIdentity: Keypair | undefined
  let commissionProduct: ProgramAccount<BondProduct>
  let customProduct: ProgramAccount<BondProduct>

  beforeEach(async () => {
    ;({ provider, program } = await initBankrunTest())
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
    }))
    ;({ bondAccount, bondAuthority, validatorIdentity } =
      await executeInitBondInstruction({
        program,
        provider,
        configAccount,
      }))

    const { bondProduct: commissionPubkey } =
      await executeInitCommissionProductInstruction({
        program,
        provider,
        bondAccount,
        authority: bondAuthority,
        inflationBps: 500,
        mevBps: 750,
        blockBps: 250,
      })
    commissionProduct = {
      publicKey: commissionPubkey,
      account: await getBondProduct(program, commissionPubkey),
    }

    const { bondProduct: customPubkey } =
      await executeInitCustomProductInstruction({
        program,
        provider,
        bondAccount,
        authority: bondAuthority,
        customName: 'test-product',
        customProductData: Buffer.from('initial data'),
      })
    customProduct = {
      publicKey: customPubkey,
      account: await getBondProduct(program, customPubkey),
    }
  })

  it('configure commission product with all BPS parameters', async () => {
    const newInflationBps = 1000
    const newMevBps = 2000
    const newBlockBps = 1500

    const { instruction } = await configureCommissionProductInstruction({
      program,
      bondProductAccount: commissionProduct.publicKey,
      authority: bondAuthority.publicKey,
      inflationBps: newInflationBps,
      mevBps: newMevBps,
      blockBps: newBlockBps,
    })

    await provider.sendIx([bondAuthority], instruction)

    const bondProductData = await getBondProduct(
      program,
      commissionProduct.publicKey,
    )
    const commissionConfig = parseCommissionData(bondProductData.configData)
    expect(commissionConfig.inflationBps).toEqual(newInflationBps)
    expect(commissionConfig.mevBps).toEqual(newMevBps)
    expect(commissionConfig.blockBps).toEqual(newBlockBps)
  })

  /* eslint-disable jest/no-conditional-expect */
  it.each(['INFLATION', 'MEV', 'BLOCK', 'UNIFORM'])(
    'configure commission product with partial parameters (only %s)',
    async bpsType => {
      const initialConfig = parseCommissionData(
        commissionProduct.account.configData,
      )
      const newInflationBps = 1000

      let configParams: Partial<ConfigureCommissionParams>
      switch (bpsType) {
        case 'INFLATION':
          configParams = { inflationBps: newInflationBps }
          break
        case 'MEV':
          configParams = { mevBps: newInflationBps }
          break
        case 'BLOCK':
          configParams = { blockBps: newInflationBps }
          break
        case 'UNIFORM':
          configParams = { uniformBps: newInflationBps }
          break
        default:
          throw new Error(`Unknown BPS type: ${bpsType}`)
      }

      await executeConfigureCommissionProductInstruction({
        program,
        provider,
        bondProductAccount: commissionProduct.publicKey,
        authority: bondAuthority,
        ...configParams,
      })

      const bondProductData = await getBondProduct(
        program,
        commissionProduct.publicKey,
      )

      const commissionConfig = parseCommissionData(bondProductData.configData)
      switch (bpsType) {
        case 'INFLATION':
          expect(commissionConfig.inflationBps).toEqual(newInflationBps)
          expect(commissionConfig.mevBps).toEqual(initialConfig.mevBps)
          expect(commissionConfig.blockBps).toEqual(initialConfig.blockBps)
          break
        case 'MEV':
          expect(commissionConfig.inflationBps).toEqual(
            initialConfig.inflationBps,
          )
          expect(commissionConfig.mevBps).toEqual(newInflationBps)
          expect(commissionConfig.blockBps).toEqual(initialConfig.blockBps)
          break
        case 'BLOCK':
          expect(commissionConfig.inflationBps).toEqual(
            initialConfig.inflationBps,
          )
          expect(commissionConfig.mevBps).toEqual(initialConfig.mevBps)
          expect(commissionConfig.blockBps).toEqual(newInflationBps)
          break
        case 'UNIFORM':
          expect(commissionConfig.inflationBps).toEqual(newInflationBps)
          expect(commissionConfig.mevBps).toEqual(newInflationBps)
          expect(commissionConfig.blockBps).toEqual(newInflationBps)
          break
      }
    },
  )

  it('configure commission product with validator identity authority', async () => {
    const newInflationBps = 1500

    const { instruction } = await configureCommissionProductInstruction({
      program,
      bondProductAccount: commissionProduct.publicKey,
      authority: validatorIdentity!.publicKey,
      inflationBps: newInflationBps,
    })

    await provider.sendIx([validatorIdentity!], instruction)

    const bondProductData = await getBondProduct(
      program,
      commissionProduct.publicKey,
    )
    const commissionConfig = parseCommissionData(bondProductData.configData)
    expect(commissionConfig.inflationBps).toEqual(newInflationBps)
  })

  it.each([
    1,
    99,
    5000,
    9999,
    MAX_BPS.toNumber(),
    0,
    -1,
    -Number.MAX_SAFE_INTEGER,
    -1 * MAX_BPS.toNumber(),
    null,
  ])('configure commission product - BPS values can be %d', async bps => {
    await executeConfigureCommissionProductInstruction({
      program,
      provider,
      bondProductAccount: commissionProduct.publicKey,
      authority: bondAuthority,
      inflationBps: bps,
      mevBps: bps,
      blockBps: bps,
    })

    const bondProductData = await getBondProduct(
      program,
      commissionProduct.publicKey,
    )
    const commissionConfig = parseCommissionData(bondProductData.configData)
    expect(
      commissionConfig.inflationBps === null
        ? null
        : commissionConfig.inflationBps.toNumber(),
    ).toEqual(bps)
    expect(
      commissionConfig.mevBps === null
        ? null
        : commissionConfig.mevBps.toNumber(),
    ).toEqual(bps)
    expect(
      commissionConfig.blockBps === null
        ? null
        : commissionConfig.blockBps.toNumber(),
    ).toEqual(bps)
  })

  it.each(['INFLATION', 'MEV', 'BLOCK', 'UNIFORM'])(
    'cannot configure commission product - %s values over 100%',
    async bpsType => {
      const overMaxBps = MAX_BPS.addn(1)

      let params: Partial<ConfigureCommissionParams>
      switch (bpsType) {
        case 'INFLATION':
          params = { inflationBps: overMaxBps }
          break
        case 'MEV':
          params = { mevBps: overMaxBps }
          break
        case 'BLOCK':
          params = { blockBps: overMaxBps }
          break
        case 'UNIFORM':
          params = { uniformBps: overMaxBps }
          break
        default:
          throw new Error(`Unknown BPS type: ${bpsType}`)
      }

      const instructionFuture = configureCommissionProductInstruction({
        program,
        bondProductAccount: commissionProduct.publicKey,
        authority: bondAuthority.publicKey,
        ...params,
      })

      await expect(instructionFuture).rejects.toThrow(
        /validateCommissionData.*cannot be greater than 10000/,
      )
    },
  )

  it('configure commission product - fails with wrong authority', async () => {
    const wrongAuthority = Keypair.generate()

    const { instruction } = await configureCommissionProductInstruction({
      program,
      bondProductAccount: commissionProduct.publicKey,
      authority: wrongAuthority.publicKey,
      inflationBps: 1000,
    })

    try {
      await provider.sendIx([wrongAuthority], instruction)
      throw new Error('Should have failed with wrong authority')
    } catch (e) {
      verifyError(e, Errors, 6076, 'Wrong authority')
    }
  })

  it('configure commission product multiple times', async () => {
    for (let i = 1; i <= 3; i++) {
      const bps = i * 1000
      await executeConfigureCommissionProductInstruction({
        program,
        provider,
        bondProductAccount: commissionProduct.publicKey,
        authority: bondAuthority,
        inflationBps: bps,
        mevBps: bps,
        blockBps: bps,
      })

      const bondProductData = await getBondProduct(
        program,
        commissionProduct.publicKey,
      )
      const commissionConfig = parseCommissionData(bondProductData.configData)
      expect(commissionConfig.inflationBps).toEqual(bps)
      expect(commissionConfig.mevBps).toEqual(bps)
      expect(commissionConfig.blockBps).toEqual(bps)
    }
  })

  it('configure custom product with new data', async () => {
    const newData = Buffer.from('updated data')

    const { instruction } = await configureCustomProductInstruction({
      program,
      bondProductAccount: customProduct.publicKey,
      authority: bondAuthority.publicKey,
      customProductData: newData,
    })

    await provider.sendIx([bondAuthority], instruction)

    const bondProductData = await getBondProduct(
      program,
      customProduct.publicKey,
    )
    const parsedData = parseCustomData(bondProductData.configData)
    expect(parsedData).toEqual(newData)
  })

  it('configure custom product to empty data', async () => {
    await executeConfigureCustomProductInstruction({
      program,
      provider,
      bondProductAccount: customProduct.publicKey,
      authority: bondAuthority,
      customProductData: Buffer.from([]),
    })

    const bondProductData = await getBondProduct(
      program,
      customProduct.publicKey,
    )
    const parsedData = parseCustomData(bondProductData.configData)
    expect(parsedData.length).toEqual(0)
  })

  it('cannot enlarge custom data now', async () => {
    const largeData = Buffer.alloc(512, 0xcd)
    // Contract currently does not support resizing the bond product account.
    // AnchorError caused by account: bond_product. Error Code: AccountDidNotSerialize.
    //   Error Number: 3004. Error Message: Failed to serialize the account.
    await expect(
      executeConfigureCustomProductInstruction({
        program,
        provider,
        bondProductAccount: customProduct.publicKey,
        authority: bondAuthority,
        customProductData: largeData,
      }),
    ).rejects.toThrow(/custom program error: 0xbbc/)
  })

  it('configure custom product multiple times', async () => {
    for (let i = 1; i <= 3; i++) {
      const data = Buffer.from(`version ${i}`)
      await executeConfigureCustomProductInstruction({
        program,
        provider,
        bondProductAccount: customProduct.publicKey,
        authority: bondAuthority,
        customProductData: data,
      })

      const bondProductData = await getBondProduct(
        program,
        customProduct.publicKey,
      )
      const parsedData = parseCustomData(bondProductData.configData)
      expect(parsedData).toEqual(data)
    }
  })

  it('configuring commission product does not affect custom product', async () => {
    const initialCustomData = parseCustomData(customProduct.account.configData)
    await executeConfigureCommissionProductInstruction({
      program,
      provider,
      bondProductAccount: commissionProduct.publicKey,
      authority: bondAuthority,
      inflationBps: 2000,
    })
    const customProductData = await getBondProduct(
      program,
      customProduct.publicKey,
    )
    const parsedData = parseCustomData(customProductData.configData)
    expect(parsedData).toEqual(Buffer.from(initialCustomData))
  })

  it('configuring custom product does not affect commission product', async () => {
    const initialCommissionConfig = parseCommissionData(
      commissionProduct.account.configData,
    )
    await executeConfigureCustomProductInstruction({
      program,
      provider,
      bondProductAccount: customProduct.publicKey,
      authority: bondAuthority,
      customProductData: Buffer.from('new data'),
    })
    const commissionProductData = await getBondProduct(
      program,
      commissionProduct.publicKey,
    )
    const commissionConfig = parseCommissionData(
      commissionProductData.configData,
    )
    expect(commissionConfig.inflationBps).toEqual(
      initialCommissionConfig.inflationBps,
    )
    expect(commissionConfig.mevBps).toEqual(initialCommissionConfig.mevBps)
    expect(commissionConfig.blockBps).toEqual(initialCommissionConfig.blockBps)
  })
})
