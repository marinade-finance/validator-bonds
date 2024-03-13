import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  CANCEL_WITHDRAW_REQUEST_EVENT,
  CancelWithdrawRequestEvent,
  ValidatorBondsProgram,
  cancelWithdrawRequestInstruction,
} from '../../src'
import { initTest } from './testValidator'
import {
  executeInitConfigInstruction,
  executeNewWithdrawRequest,
} from '../utils/testTransactions'
import { ExtendedProvider } from '../utils/provider'

describe('Validator Bonds cancel withdraw request', () => {
  let provider: ExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let bondAccount: PublicKey
  let withdrawRequestAccount: PublicKey
  let validatorIdentity: Keypair
  const requestedAmount = 2 * LAMPORTS_PER_SOL

  beforeAll(async () => {
    ;({ provider, program } = await initTest())
  })

  afterAll(async () => {
    // workaround: "Jest has detected the following 1 open handle", see `initConfig.spec.ts`
    await new Promise(resolve => setTimeout(resolve, 500))
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
    const event = new Promise<CancelWithdrawRequestEvent>(resolve => {
      const listener = program.addEventListener(
        CANCEL_WITHDRAW_REQUEST_EVENT,
        async event => {
          await program.removeEventListener(listener)
          resolve(event)
        }
      )
    })

    const { instruction } = await cancelWithdrawRequestInstruction({
      program,
      withdrawRequestAccount,
      authority: validatorIdentity.publicKey,
    })
    await provider.sendIx([validatorIdentity], instruction)
    expect(
      provider.connection.getAccountInfo(withdrawRequestAccount)
    ).resolves.toBeNull()

    await event.then(e => {
      expect(e.withdrawRequest).toEqual(withdrawRequestAccount)
      expect(e.bond).toEqual(bondAccount)
      expect(e.authority).toEqual(validatorIdentity.publicKey)
      expect(e.requestedAmount).toEqual(requestedAmount)
      expect(e.withdrawnAmount).toEqual(0)
    })
  })
})
