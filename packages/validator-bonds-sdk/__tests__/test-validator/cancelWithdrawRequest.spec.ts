import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  CANCEL_WITHDRAW_REQUEST_EVENT,
  ValidatorBondsProgram,
  assertEvent,
  cancelWithdrawRequestInstruction,
  parseCpiEvents,
} from '../../src'
import { initTest } from './testValidator'
import {
  executeInitConfigInstruction,
  executeNewWithdrawRequest,
} from '../utils/testTransactions'
import { executeTxSimple, transaction } from '@marinade.finance/web3js-common'
import assert from 'assert'
import { AnchorExtendedProvider } from '@marinade.finance/anchor-common'

describe('Validator Bonds cancel withdraw request', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let bondAccount: PublicKey
  let withdrawRequestAccount: PublicKey
  let validatorIdentity: Keypair
  const requestedAmount = 2 * LAMPORTS_PER_SOL

  beforeAll(async () => {
    ;({ provider, program } = await initTest())
  })

  beforeEach(async () => {
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
    }))
    ;({ withdrawRequestAccount, validatorIdentity, bondAccount } =
      await executeNewWithdrawRequest({
        program,
        provider,
        configAccount,
        amount: requestedAmount,
      }))
  })

  it('cancel withdraw request', async () => {
    const tx = await transaction(provider)
    const { instruction } = await cancelWithdrawRequestInstruction({
      program,
      withdrawRequestAccount,
      authority: validatorIdentity.publicKey,
    })
    tx.add(instruction)
    const executionReturn = await executeTxSimple(provider.connection, tx, [
      provider.wallet,
      validatorIdentity,
    ])
    expect(
      provider.connection.getAccountInfo(withdrawRequestAccount)
    ).resolves.toBeNull()

    const events = parseCpiEvents(program, executionReturn?.response)
    const e = assertEvent(events, CANCEL_WITHDRAW_REQUEST_EVENT)
    // Ensure the event was emitted
    assert(e !== undefined)
    expect(e.withdrawRequest).toEqual(withdrawRequestAccount)
    expect(e.bond).toEqual(bondAccount)
    expect(e.authority).toEqual(validatorIdentity.publicKey)
    expect(e.requestedAmount).toEqual(requestedAmount)
    expect(e.withdrawnAmount).toEqual(0)
  })
})
