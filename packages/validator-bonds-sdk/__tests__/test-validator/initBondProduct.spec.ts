import assert from 'assert'

import { getAnchorValidatorInfo } from '@marinade.finance/anchor-common'
import { NULL_LOG } from '@marinade.finance/ts-common'
import {
  executeTxSimple,
  signer,
  splitAndExecuteTx,
  transaction,
} from '@marinade.finance/web3js-1x'

import {
  INIT_BOND_PRODUCT_EVENT,
  assertEvent,
  bondProductAddress,
  findBondProducts,
  getBondProduct,
  initCommissionProductInstruction,
  initCustomProductInstruction,
  parseCpiEvents,
  ProductTypes,
} from '../../src'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '../utils/testTransactions'
import { initTest } from '../utils/testValidator'

import type { ValidatorBondsProgram } from '../../src'
import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import type { Wallet } from '@marinade.finance/web3js-1x'
import type { Keypair, PublicKey, Signer } from '@solana/web3.js'

describe('Validator Bonds init bond product', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let validatorIdentity: Keypair
  let configAccount: PublicKey
  let bondAccount: PublicKey
  let bondAuthority: Keypair
  let voteAccount: PublicKey

  beforeEach(async () => {
    ;({ provider, program } = initTest())
    ;({ validatorIdentity } = await getAnchorValidatorInfo(provider.connection))
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
    }))
    ;({ bondAccount, bondAuthority, voteAccount } =
      await executeInitBondInstruction({
        program,
        provider,
        configAccount,
        validatorIdentity,
      }))
    console.log('Initialized bond:', bondAccount.toBase58())
  })

  it('init commission bond product', async () => {
    const inflationBps = 500
    const mevBps = 750
    const blockBps = 250

    const tx = await transaction(provider)

    const { instruction, bondProduct } = await initCommissionProductInstruction(
      {
        program,
        bondAccount,
        authority: bondAuthority.publicKey,
        inflationBps,
        mevBps,
        blockBps,
      },
    )
    tx.add(instruction)

    const executionReturn = await executeTxSimple(provider.connection, tx, [
      provider.wallet,
      bondAuthority,
    ])

    const bondProductData = await getBondProduct(program, bondProduct)
    expect(bondProductData.bond).toEqual(bondAccount)
    expect(bondProductData.config).toEqual(configAccount)
    expect(bondProductData.voteAccount).toEqual(voteAccount)
    expect(bondProductData.productType).toEqual(ProductTypes.commission)

    const [expectedAddress, bump] = bondProductAddress(
      bondAccount,
      ProductTypes.commission,
      program.programId,
    )
    expect(bondProduct).toEqual(expectedAddress)
    expect(bondProductData.bump).toEqual(bump)

    const events = parseCpiEvents(program, executionReturn?.response)
    const e = assertEvent(events, INIT_BOND_PRODUCT_EVENT)
    assert(e !== undefined)
    expect(e.bond).toEqual(bondAccount)
    expect(e.bondProduct).toEqual(bondProduct)
    expect(e.config).toEqual(configAccount)
    expect(e.voteAccount).toEqual(voteAccount)
  })

  it('init custom bond product', async () => {
    const customName = 'test-product'
    const customData = Buffer.from('test data 123')

    const tx = await transaction(provider)

    const { instruction, bondProduct } = await initCustomProductInstruction({
      program,
      bondAccount,
      authority: validatorIdentity.publicKey,
      customName,
      customProductData: customData,
    })
    tx.add(instruction)

    const executionReturn = await executeTxSimple(provider.connection, tx, [
      provider.wallet,
      validatorIdentity,
    ])

    const bondProductData = await getBondProduct(program, bondProduct)
    expect(bondProductData.bond).toEqual(bondAccount)
    expect(bondProductData.config).toEqual(configAccount)
    expect(bondProductData.voteAccount).toEqual(voteAccount)
    expect(bondProductData.productType.custom).toBeDefined()

    const [expectedAddress, bump] = bondProductAddress(
      bondAccount,
      ProductTypes.custom(customName),
      program.programId,
    )
    expect(bondProduct).toEqual(expectedAddress)
    expect(bondProductData.bump).toEqual(bump)

    const events = parseCpiEvents(program, executionReturn?.response)
    const e = assertEvent(events, INIT_BOND_PRODUCT_EVENT)
    assert(e !== undefined)
    expect(e.bond).toEqual(bondAccount)
    expect(e.bondProduct).toEqual(bondProduct)
  })

  it('find bond products', async () => {
    const tx = await transaction(provider)
    const signers: (Signer | Wallet)[] = [
      provider.wallet,
      signer(bondAuthority),
    ]

    const { instruction: commissionInstruction } =
      await initCommissionProductInstruction({
        program,
        bondAccount,
        authority: bondAuthority.publicKey,
        inflationBps: 500,
        mevBps: 750,
        blockBps: 250,
      })
    tx.add(commissionInstruction)

    const customProducts = ['product-1', 'product-2', 'product-3']
    for (const customName of customProducts) {
      const { instruction } = await initCustomProductInstruction({
        program,
        bondAccount,
        authority: bondAuthority.publicKey,
        customName,
        customProductData: Buffer.from(`data for ${customName}`),
      })
      tx.add(instruction)
    }

    await splitAndExecuteTx({
      connection: provider.connection,
      transaction: tx,
      signers,
      errMessage: 'Failed to init bond products',
    })

    // Find all bond products for this bond
    let bondProducts = await findBondProducts({
      program,
      bond: bondAccount,
      logger: NULL_LOG,
    })
    expect(bondProducts.length).toEqual(4) // 1 commission + 3 custom

    // Find by config account
    bondProducts = await findBondProducts({
      program,
      configAccount,
      logger: NULL_LOG,
    })
    expect(bondProducts.length).toEqual(4)

    // Find by vote account
    bondProducts = await findBondProducts({
      program,
      voteAccount,
      logger: NULL_LOG,
    })
    expect(bondProducts.length).toEqual(4)

    // Find commission product specifically
    bondProducts = await findBondProducts({
      program,
      bond: bondAccount,
      productType: ProductTypes.commission,
      logger: NULL_LOG,
    })
    // some other tests may have created commission products too
    expect(bondProducts.length).toBeGreaterThanOrEqual(1)
    expect(bondProducts[0]?.account.productType).toEqual(
      ProductTypes.commission,
    )

    // Find specific custom product
    bondProducts = await findBondProducts({
      program,
      bond: bondAccount,
      productType: ProductTypes.custom('product-2'),
      logger: NULL_LOG,
    })
    expect(bondProducts.length).toEqual(1)
    expect(bondProducts[0]?.account.productType.custom).toBeDefined()
  })
})
