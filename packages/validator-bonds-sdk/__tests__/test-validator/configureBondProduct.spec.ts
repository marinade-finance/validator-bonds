import assert from 'assert'

import { getAnchorValidatorInfo } from '@marinade.finance/anchor-common'
import { executeTxSimple, transaction } from '@marinade.finance/web3js-1x'

import {
  CONFIGURE_BOND_PRODUCT_EVENT,
  assertEvent,
  configureCommissionProductInstruction,
  configureCustomProductInstruction,
  getBondProduct,
  parseCpiEvents,
  parseCommissionData,
  parseCustomData,
} from '../../src'
import {
  executeInitBondInstruction,
  executeInitCommissionProductInstruction,
  executeInitConfigInstruction,
  executeInitCustomProductInstruction,
} from '../utils/testTransactions'
import { initTest } from '../utils/testValidator'

import type { ValidatorBondsProgram } from '../../src'
import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import type { Keypair } from '@solana/web3.js'
import type { PublicKey } from '@solana/web3.js'

describe('Validator Bonds configure bond product', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let validatorIdentity: Keypair
  let configAccount: PublicKey
  let bondAccount: PublicKey
  let bondAuthority: Keypair

  beforeAll(async () => {
    ;({ provider, program } = initTest())
    ;({ validatorIdentity } = await getAnchorValidatorInfo(provider.connection))
  })

  beforeEach(async () => {
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
    }))
    ;({ bondAccount, bondAuthority } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      validatorIdentity,
    }))
  })

  it('configure commission product', async () => {
    const { bondProduct: commissionProduct } =
      await executeInitCommissionProductInstruction({
        program,
        provider,
        bondAccount,
        authority: bondAuthority,
        inflationBps: 500,
        mevBps: 750,
        blockBps: 250,
      })

    const newInflationBps = 1000
    const newMevBps = 2000
    const newBlockBps = 1500

    const tx = await transaction(provider)

    const { instruction } = await configureCommissionProductInstruction({
      program,
      bondProductAccount: commissionProduct,
      authority: bondAuthority.publicKey,
      inflationBps: newInflationBps,
      mevBps: newMevBps,
      blockBps: newBlockBps,
    })
    tx.add(instruction)

    const executionReturn = await executeTxSimple(provider.connection, tx, [
      provider.wallet,
      bondAuthority,
    ])

    const bondProductData = await getBondProduct(program, commissionProduct)
    const commissionConfig = parseCommissionData(bondProductData.configData)
    expect(commissionConfig.inflationBps).toEqual(newInflationBps)
    expect(commissionConfig.mevBps).toEqual(newMevBps)
    expect(commissionConfig.blockBps).toEqual(newBlockBps)

    const events = parseCpiEvents(program, executionReturn?.response)
    const e = assertEvent(events, CONFIGURE_BOND_PRODUCT_EVENT)
    assert(e !== undefined)
    expect(e.bondProduct).toEqual(commissionProduct)
  })

  it('configure custom product', async () => {
    const { bondProduct: customProduct } =
      await executeInitCustomProductInstruction({
        program,
        provider,
        bondAccount,
        authority: bondAuthority,
        customName: 'test-product',
        customProductData: Buffer.from('initial data'),
      })

    const newData = Buffer.from('updated data')

    const tx = await transaction(provider)

    const { instruction } = await configureCustomProductInstruction({
      program,
      bondProductAccount: customProduct,
      authority: bondAuthority.publicKey,
      customProductData: newData,
    })
    tx.add(instruction)

    const executionReturn = await executeTxSimple(provider.connection, tx, [
      provider.wallet,
      bondAuthority,
    ])

    const bondProductData = await getBondProduct(program, customProduct)
    const parsedData = parseCustomData(bondProductData.configData)
    expect(parsedData).toEqual(newData)

    const events = parseCpiEvents(program, executionReturn?.response)
    const e = assertEvent(events, CONFIGURE_BOND_PRODUCT_EVENT)
    assert(e !== undefined)
    expect(e.bondProduct).toEqual(customProduct)
  })
})
