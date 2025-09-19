import { Keypair, PublicKey } from '@solana/web3.js'
import {
  CONFIGURE_BOND_EVENT,
  ValidatorBondsProgram,
  assertEvent,
  configureBondInstruction,
  getBond,
  parseCpiEvents,
} from '../../src'
import { initTest } from './testValidator'
import {
  executeConfigureConfigInstruction,
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '../utils/testTransactions'
import { executeTxSimple, transaction } from '@marinade.finance/web3js-1x'
import {
  AnchorExtendedProvider,
  getAnchorValidatorInfo,
} from '@marinade.finance/anchor-common'
import assert from 'assert'

describe('Validator Bonds configure bond', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let validatorIdentity: Keypair
  let configAccount: PublicKey

  beforeAll(async () => {
    ;({ provider, program } = await initTest())
    ;({ validatorIdentity } = await getAnchorValidatorInfo(provider.connection))
  })

  beforeEach(async () => {
    const { configAccount: ca, adminAuthority } =
      await executeInitConfigInstruction({
        program,
        provider,
      })
    configAccount = ca
    await executeConfigureConfigInstruction({
      program,
      provider,
      configAccount,
      adminAuthority,
      newMinBondMaxStakeWanted: 9999,
    })
  })

  it('configure bond', async () => {
    const { bondAccount, bondAuthority } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      validatorIdentity,
      cpmpe: 22,
    })

    const tx = await transaction(provider)

    const newBondAuthority = Keypair.generate()
    const { instruction } = await configureBondInstruction({
      program,
      bondAccount,
      authority: bondAuthority,
      newBondAuthority: newBondAuthority.publicKey,
      newCpmpe: 31,
      newMaxStakeWanted: 1_000_001,
    })
    tx.add(instruction)
    const executionReturn = await executeTxSimple(provider.connection, tx, [
      provider.wallet,
      bondAuthority,
    ])

    const bondData = await getBond(program, bondAccount)
    expect(bondData.authority).toEqual(newBondAuthority.publicKey)
    expect(bondData.config).toEqual(configAccount)
    expect(bondData.cpmpe).toEqual(31)
    expect(bondData.authority).toEqual(newBondAuthority.publicKey)
    expect(bondData.maxStakeWanted).toEqual(1_000_001)

    const events = parseCpiEvents(program, executionReturn?.response)
    const e = assertEvent(events, CONFIGURE_BOND_EVENT)
    // Ensure the event was emitted
    assert(e !== undefined)
    expect(e.bondAuthority).toEqual({
      old: bondAuthority.publicKey,
      new: newBondAuthority.publicKey,
    })
    expect(e.cpmpe).toEqual({
      old: 22,
      new: 31,
    })
    expect(e.maxStakeWanted).toEqual({
      old: 0,
      new: 1_000_001,
    })
  })
})
