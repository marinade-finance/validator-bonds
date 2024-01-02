import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  INIT_WITHDRAW_REQUEST_EVENT,
  InitWithdrawRequestEvent,
  ValidatorBondsProgram,
  getWithdrawRequest,
  initWithdrawRequestInstruction,
  withdrawRequestAddress,
} from '../../src'
import { initTest } from './testValidator'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '../utils/testTransactions'
import { ExtendedProvider } from '../utils/provider'
import { createVoteAccount } from '../utils/staking'

describe('Validator Bonds init withdraw request', () => {
  let provider: ExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let bondAccount: PublicKey
  let bondAuthority: Keypair
  let validatorVoteAccount: PublicKey

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
    const { voteAccount, validatorIdentity } = await createVoteAccount(provider)
    validatorVoteAccount = voteAccount
    ;({ bondAccount, bondAuthority } = await executeInitBondInstruction(
      program,
      provider,
      configAccount,
      undefined,
      validatorVoteAccount,
      validatorIdentity
    ))
  })

  it('init withdraw request', async () => {
    const event = new Promise<InitWithdrawRequestEvent>(resolve => {
      const listener = program.addEventListener(
        INIT_WITHDRAW_REQUEST_EVENT,
        async event => {
          await program.removeEventListener(listener)
          resolve(event)
        }
      )
    })

    const { instruction, withdrawRequest } =
      await initWithdrawRequestInstruction({
        program,
        bondAccount,
        configAccount,
        authority: bondAuthority,
        amount: 2 * LAMPORTS_PER_SOL,
      })
    await provider.sendIx([bondAuthority], instruction)

    const epoch = (await provider.connection.getEpochInfo()).epoch
    const [, bump] = withdrawRequestAddress(bondAccount, program.programId)
    const withdrawRequestData = await getWithdrawRequest(
      program,
      withdrawRequest
    )
    expect(withdrawRequestData.bond).toEqual(bondAccount)
    expect(withdrawRequestData.bump).toEqual(bump)
    expect(withdrawRequestData.epoch).toEqual(epoch)
    expect(withdrawRequestData.requestedAmount).toEqual(LAMPORTS_PER_SOL)
    expect(withdrawRequestData.validatorVoteAccount).toEqual(
      validatorVoteAccount
    )
    expect(withdrawRequestData.withdrawnAmount).toEqual(0)

    await event.then(e => {
      expect(e.withdrawRequest).toEqual(withdrawRequest)
      expect(e.bond).toEqual(bondAccount)
      expect(e.bump).toEqual(bump)
      expect(e.epoch).toEqual(epoch)
      expect(e.requestedAmount).toEqual(LAMPORTS_PER_SOL)
      expect(e.validatorVoteAccount).toEqual(validatorVoteAccount)
    })
  })
})
