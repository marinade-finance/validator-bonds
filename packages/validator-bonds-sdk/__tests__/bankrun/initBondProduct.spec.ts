import { anchorProgramWalletPubkey } from '@marinade.finance/anchor-common'
import { createUserAndFund, pubkey, signer } from '@marinade.finance/web3js-1x'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'
import { BN } from 'bn.js'

import { initBankrunTest } from './bankrun'
import {
  bondProductAddress,
  getBondProduct,
  initCommissionProductInstruction,
  initCustomProductInstruction,
  ProductTypes,
  parseCommissionData,
  parseCustomData,
  MAX_BPS,
  getCommissionData,
} from '../../src'
import { customTestResult } from '../utils/helpers'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitCommissionProductInstruction,
  executeInitCustomProductInstruction,
} from '../utils/testTransactions'

import type { ProductTypeConfig, ValidatorBondsProgram } from '../../src'
import type { BankrunExtendedProvider } from '@marinade.finance/bankrun-utils'
import type { Keypair } from '@solana/web3.js'

describe('Validator Bonds init bond product account', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let bondAccount: PublicKey
  let bondAuthority: Keypair
  let voteAccount: PublicKey
  let validatorIdentity: Keypair | undefined

  beforeEach(async () => {
    ;({ provider, program } = await initBankrunTest())
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
    }))
    ;({ bondAccount, bondAuthority, voteAccount, validatorIdentity } =
      await executeInitBondInstruction({
        program,
        provider,
        configAccount,
      }))
  })

  it('init commission bond product', async () => {
    const inflationBps = 500
    const mevBps = 750
    const blockBps = 250

    const rentWallet = await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL,
    })

    const { instruction, bondProduct } = await initCommissionProductInstruction(
      {
        program,
        bondAccount,
        authority: bondAuthority.publicKey,
        rentPayer: rentWallet,
        inflationBps,
        mevBps,
        blockBps,
      },
    )

    await provider.sendIx([bondAuthority, signer(rentWallet)], instruction)

    const bondProductData = await getBondProduct(program, bondProduct)
    expect(bondProductData.bond).toEqual(bondAccount)
    expect(bondProductData.config).toEqual(configAccount)
    expect(bondProductData.voteAccount).toEqual(voteAccount)
    expect(bondProductData.productType).toEqual(ProductTypes.commission)

    const commissionConfig = parseCommissionData(bondProductData.configData)
    expect(commissionConfig.inflationBps).toEqual(inflationBps)
    expect(commissionConfig.mevBps).toEqual(mevBps)
    expect(commissionConfig.blockBps).toEqual(blockBps)

    const [expectedAddress, bump] = bondProductAddress(
      bondAccount,
      ProductTypes.commission,
      program.programId,
    )
    expect(bondProduct).toEqual(expectedAddress)
    expect(bondProductData.bump).toEqual(bump)
  })

  it('cannot set unify and particular commissions', async () => {
    await expect(
      initCommissionProductInstruction({
        program,
        bondAccount,
        authority: bondAuthority.publicKey,
        rentPayer: PublicKey.default,
        uniformBps: 111,
        inflationBps: 50,
      }),
    ).rejects.toThrow(/cannot set both/)
  })

  it('init commission product with validator identity signer', async () => {
    const { instruction, bondProduct } = await initCommissionProductInstruction(
      {
        program,
        bondAccount,
        authority: validatorIdentity!.publicKey,
        inflationBps: 150,
        mevBps: 250,
        blockBps: 350,
      },
    )

    await provider.sendIx([validatorIdentity!], instruction)

    const bondProductData = await getBondProduct(program, bondProduct)
    const commissionConfig = parseCommissionData(bondProductData.configData)
    expect(commissionConfig.inflationBps).toEqual(150)
    expect(commissionConfig.mevBps).toEqual(250)
    expect(commissionConfig.blockBps).toEqual(350)
  })

  it('init commission product permission-less', async () => {
    const { instruction, bondProduct } = await initCommissionProductInstruction(
      {
        program,
        bondAccount,
        inflationBps: 1,
        mevBps: 2,
        blockBps: 3,
      },
    )

    await provider.sendIx([], instruction)

    const bondProductData = await getBondProduct(program, bondProduct)
    const commissionConfig = parseCommissionData(bondProductData.configData)
    expect(commissionConfig.inflationBps).toBeNull()
    expect(commissionConfig.mevBps).toBeNull()
    expect(commissionConfig.blockBps).toBeNull()
  })

  it('init unify commission product', async () => {
    const rentPayer = await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL,
    })

    const { instruction, bondProduct } = await initCommissionProductInstruction(
      {
        program,
        bondAccount,
        authority: bondAuthority.publicKey,
        rentPayer: pubkey(rentPayer),
        uniformBps: 111,
      },
    )

    await provider.sendIx([signer(rentPayer), bondAuthority], instruction)

    const bondProductData = await getBondProduct(program, bondProduct)
    expect(bondProductData.bond).toEqual(bondAccount)

    const commissionConfig = parseCommissionData(bondProductData.configData)
    expect(commissionConfig.inflationBps).toEqual(111)
    expect(commissionConfig.mevBps).toEqual(111)
    expect(commissionConfig.blockBps).toEqual(111)
  })

  it.each([0, 5, 10_000, -1, -100, -Number.MAX_SAFE_INTEGER, null])(
    'init commission product - BPS values can be %d',
    async bpsValue => {
      const { bondProduct } = await executeInitCommissionProductInstruction({
        program,
        provider,
        bondAccount,
        authority: bondAuthority,
        inflationBps: bpsValue,
        mevBps: bpsValue,
        blockBps: bpsValue,
      })

      const bondProductData = await getBondProduct(program, bondProduct)
      const commissionConfig = parseCommissionData(bondProductData.configData)
      expect(
        commissionConfig.inflationBps
          ? commissionConfig.inflationBps.toNumber()
          : null,
      ).toEqual(bpsValue)
      expect(
        commissionConfig.mevBps ? commissionConfig.mevBps.toNumber() : null,
      ).toEqual(bpsValue)
      expect(
        commissionConfig.blockBps ? commissionConfig.blockBps.toNumber() : null,
      ).toEqual(bpsValue)
    },
  )

  it('cannot setup with wrong authority', async () => {
    const bondProduct = bondProductAddress(
      bondAccount,
      ProductTypes.commission,
      program.programId,
    )[0]
    const instruction = await program.methods
      .initBondProduct({
        productType: ProductTypes.commission,
        configData: getCommissionData({
          inflationBps: new BN(100),
          mevBps: new BN(200),
          blockBps: new BN(300),
        }),
      })
      .accountsPartial({
        config: configAccount,
        bond: bondAccount,
        voteAccount,
        bondProduct,
        authority: anchorProgramWalletPubkey(program),
        rentPayer: anchorProgramWalletPubkey(program),
      })
      .instruction()

    await expect(provider.sendIx([], instruction)).rejects.toThrow(
      /custom program error: 0x17bc/,
    )
  })

  it.each(['INFLATION', 'MEV', 'BLOCK'])(
    'cannot init commission product %s: values over 100%',
    async bpsType => {
      const overMaxBps = MAX_BPS.addn(1)

      let productTypeConfig: ProductTypeConfig
      switch (bpsType) {
        case 'INFLATION':
          productTypeConfig = getCommissionData({
            inflationBps: overMaxBps,
            mevBps: new BN(1),
            blockBps: new BN(1),
          })
          break
        case 'MEV':
          productTypeConfig = getCommissionData({
            inflationBps: new BN(1),
            mevBps: overMaxBps,
            blockBps: new BN(1),
          })
          break
        case 'BLOCK':
          productTypeConfig = getCommissionData({
            inflationBps: new BN(1),
            mevBps: new BN(1),
            blockBps: overMaxBps,
          })
          break
        default:
          throw new Error(`Unknown bpsType: ${bpsType}`)
      }
      const bondProduct = bondProductAddress(
        bondAccount,
        ProductTypes.commission,
        program.programId,
      )[0]
      const instruction = await program.methods
        .initBondProduct({
          productType: ProductTypes.commission,
          configData: productTypeConfig,
        })
        .accountsPartial({
          config: configAccount,
          bond: bondAccount,
          voteAccount,
          bondProduct,
          authority: bondAuthority.publicKey,
          rentPayer: anchorProgramWalletPubkey(program),
        })
        .instruction()

      await expect(
        provider.sendIx([signer(bondAuthority)], instruction),
      ).rejects.toThrow(/custom program error: 0x17be/)
    },
  )

  it('cannot init commission product when already exists', async () => {
    const { bondProduct } = await executeInitCommissionProductInstruction({
      program,
      provider,
      bondAccount,
      authority: bondAuthority,
      inflationBps: 500,
      mevBps: 500,
      blockBps: 500,
    })
    expect(await provider.connection.getAccountInfo(bondProduct)).not.toBeNull()

    const { instruction } = await initCommissionProductInstruction({
      program,
      bondAccount,
      authority: bondAuthority.publicKey,
      inflationBps: 1,
      mevBps: 1,
      blockBps: 1,
    })

    await expect(
      provider.sendIx([signer(bondAuthority)], instruction),
    ).rejects.toThrow(/custom program error: 0x0/)
  })

  it('init custom bond product', async () => {
    const customName = 'test-product'
    const customData = Buffer.from('test data 123')

    const { instruction, bondProduct } = await initCustomProductInstruction({
      program,
      bondAccount,
      authority: validatorIdentity!.publicKey,
      customName,
      customProductData: customData,
    })

    await provider.sendIx([signer(validatorIdentity)], instruction)

    const bondProductData = await getBondProduct(program, bondProduct)
    expect(bondProductData.bond).toEqual(bondAccount)
    expect(bondProductData.config).toEqual(configAccount)
    expect(bondProductData.voteAccount).toEqual(voteAccount)
    expect(bondProductData.productType).toEqual(customTestResult(customName))

    const parsedData = parseCustomData(bondProductData.configData)
    expect(parsedData).toEqual(customData)

    // Verify account address derivation
    const [expectedAddress, bump] = bondProductAddress(
      bondAccount,
      ProductTypes.custom(customName),
      program.programId,
    )
    expect(bondProduct).toEqual(expectedAddress)
    expect(bondProductData.bump).toEqual(bump)
  })

  it('init custom product with validator identity', async () => {
    const rentPayer = await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL,
    })
    const customName = 'auth-product'
    const customData = Buffer.from([1, 2, 3, 4, 5])

    const { instruction, bondProduct } = await initCustomProductInstruction({
      program,
      bondAccount,
      authority: validatorIdentity!.publicKey,
      rentPayer: pubkey(rentPayer),
      customName,
      customProductData: customData,
    })

    await provider.sendIx(
      [signer(rentPayer), signer(validatorIdentity)],
      instruction,
    )

    const bondProductData = await getBondProduct(program, bondProduct)
    expect(bondProductData.bond).toEqual(bondAccount)

    const parsedData = parseCustomData(bondProductData.configData)
    expect(parsedData).toEqual(customData)
  })

  it('cannot init custom product with empty name', async () => {
    const instructionFuture = initCustomProductInstruction({
      program,
      bondAccount,
      authority: bondAuthority,
      customName: '',
      customProductData: Buffer.from('test'),
    })

    await expect(instructionFuture).rejects.toThrow(
      /customName cannot be empty/,
    )
  })

  it('cannot init custom product with name longer than 32 characters', async () => {
    const longName = 'a'.repeat(33)

    const instructionFuture = initCustomProductInstruction({
      program,
      bondAccount,
      authority: bondAuthority,
      customName: longName,
      customProductData: Buffer.from('test'),
    })

    await expect(instructionFuture).rejects.toThrow(
      /customName cannot be longer than 32 characters/,
    )
  })

  it('init both commission and custom products for same bond', async () => {
    const { bondProduct: commissionProduct } =
      await executeInitCommissionProductInstruction({
        program,
        provider,
        bondAccount,
        authority: bondAuthority,
        inflationBps: 500,
        mevBps: 500,
        blockBps: 500,
      })

    const { bondProduct: customProduct } =
      await executeInitCustomProductInstruction({
        program,
        provider,
        bondAccount,
        authority: bondAuthority,
        customName: 'custom',
        customProductData: Buffer.from('test'),
      })

    expect(commissionProduct).not.toEqual(customProduct)

    const commissionData = await getBondProduct(program, commissionProduct)
    const customData = await getBondProduct(program, customProduct)

    expect(commissionData.bond).toEqual(bondAccount)
    expect(customData.bond).toEqual(bondAccount)
    expect(commissionData.productType).toEqual(ProductTypes.commission)
    expect(customData.productType).toEqual(customTestResult('custom'))
  })

  it('init multiple custom products with different names for same bond', async () => {
    const customName1 = 'product-one'
    const customName2 = 'product-two'

    const { bondProduct: bondProduct1 } =
      await executeInitCustomProductInstruction({
        program,
        provider,
        bondAccount,
        authority: bondAuthority,
        customName: customName1,
        customProductData: Buffer.from('data1'),
      })

    const { bondProduct: bondProduct2 } =
      await executeInitCustomProductInstruction({
        program,
        provider,
        bondAccount,
        authority: bondAuthority,
        customName: customName2,
        customProductData: Buffer.from('data2'),
      })

    expect(bondProduct1).not.toEqual(bondProduct2)

    const bondProductData1 = await getBondProduct(program, bondProduct1)
    const bondProductData2 = await getBondProduct(program, bondProduct2)

    expect(bondProductData1.productType).toEqual(customTestResult(customName1))
    expect(bondProductData2.productType).toEqual(customTestResult(customName2))
    expect(bondProductData1.bond).toEqual(bondAccount)
    expect(bondProductData2.bond).toEqual(bondAccount)
  })
})
