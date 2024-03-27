import { Keypair, PublicKey } from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  configureBondWithMintInstruction,
  getBond,
  mintBondInstruction,
  CONFIGURE_BOND_WITH_MINT_EVENT,
  parseCpiEvents,
  assertEvent,
} from '../../src'
import { initTest } from './testValidator'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '../utils/testTransactions'
import { executeTxSimple, transaction } from '@marinade.finance/web3js-common'
import { getAccount as getTokenAccount } from 'solana-spl-token-modern'
import {
  AnchorExtendedProvider,
  getAnchorValidatorInfo,
} from '@marinade.finance/anchor-common'
import assert from 'assert'

describe('Validator Bonds configure bond with mint', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let validatorIdentity: Keypair
  let configAccount: PublicKey

  beforeAll(async () => {
    ;({ provider, program } = await initTest())
    ;({ validatorIdentity } = await getAnchorValidatorInfo(provider.connection))
  })

  beforeEach(async () => {
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
    }))
  })

  it('mint bond', async () => {
    const { bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      validatorIdentity,
    })
    const oldBondData = await getBond(program, bondAccount)

    const tx = await transaction(provider)

    const { instruction: ixMint, validatorIdentityTokenAccount } =
      await mintBondInstruction({
        program,
        bondAccount,
        validatorIdentity: validatorIdentity.publicKey,
      })
    const newBondAuthority = PublicKey.unique()
    const newCpmpe = 1000
    const { instruction } = await configureBondWithMintInstruction({
      program,
      bondAccount,
      tokenAuthority: validatorIdentity.publicKey,
      newCpmpe,
      newBondAuthority,
    })
    tx.add(ixMint).add(instruction)
    const executionReturn = await executeTxSimple(provider.connection, tx, [
      provider.wallet,
      validatorIdentity,
    ])

    const tokenData = await getTokenAccount(
      provider.connection,
      validatorIdentityTokenAccount
    )
    expect(tokenData.amount).toEqual(0) // burnt
    const bondData = await getBond(program, bondAccount)
    expect(bondData.authority).toEqual(newBondAuthority)
    expect(bondData.cpmpe).toEqual(newCpmpe)

    const events = parseCpiEvents(program, executionReturn?.response)
    const e = assertEvent(events, CONFIGURE_BOND_WITH_MINT_EVENT)
    // Ensure the event was emitted
    assert(e !== undefined)
    expect(e.validatorIdentity).toEqual(validatorIdentity.publicKey)
    expect(e.bondAuthority).toEqual({
      old: oldBondData.authority,
      new: newBondAuthority,
    })
    expect(e.cpmpe).toEqual({
      old: oldBondData.cpmpe,
      new: newCpmpe,
    })
  })
})
