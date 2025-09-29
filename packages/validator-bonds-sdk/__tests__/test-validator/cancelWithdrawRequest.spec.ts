import assert from 'assert'

import { executeTxSimple, transaction } from '@marinade.finance/web3js-1x'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'

import {
  CANCEL_WITHDRAW_REQUEST_EVENT,
  assertEvent,
  cancelWithdrawRequestInstruction,
  parseCpiEvents,
} from '../../src'
import {
  executeInitConfigInstruction,
  executeNewWithdrawRequest,
} from '../utils/testTransactions'
import { initTest } from '../utils/testValidator'

import type { ValidatorBondsProgram } from '../../src'
import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import type { Keypair, PublicKey } from '@solana/web3.js'

describe('Validator Bonds cancel withdraw request', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let bondAccount: PublicKey
  let withdrawRequestAccount: PublicKey
  let validatorIdentity: Keypair
  const requestedAmount = 2 * LAMPORTS_PER_SOL

  beforeAll(() => {
    ;({ provider, program } = initTest())
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
      await provider.connection.getAccountInfo(withdrawRequestAccount),
    ).toBeNull()

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
