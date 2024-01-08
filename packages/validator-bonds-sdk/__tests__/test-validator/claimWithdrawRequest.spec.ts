import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { ValidatorBondsProgram, getVoteAccount } from '../../src'
import { initTest } from './testValidator'
import {
  executeInitConfigInstruction,
  executeNewWithdrawRequest,
} from '../utils/testTransactions'
import { ExtendedProvider } from '../utils/provider'

describe('Validator Bonds claim withdraw request', () => {
  let provider: ExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let bondAccount: PublicKey
  let withdrawRequest: PublicKey
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
    ;({ withdrawRequest, validatorIdentity, bondAccount } =
      await executeNewWithdrawRequest({
        program,
        provider,
        configAccount,
        amount: requestedAmount,
      }))
  })

  it('cancel withdraw request', async () => {
    const va = await provider.connection.getVoteAccounts()
    const gva = await getVoteAccount(
      provider,
      new PublicKey(va.current[0].votePubkey)
    )
    console.log('parssssed', gva.publicKey.toBase58())
  })
})
