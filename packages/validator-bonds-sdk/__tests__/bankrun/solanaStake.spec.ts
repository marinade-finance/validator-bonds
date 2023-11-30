import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  getConfig,
  initConfigInstruction,
} from '../../src'
import { BankrunProvider } from 'anchor-bankrun'
import {
  bankrunExecute,
  bankrunTransaction,
  initBankrunTest,
} from './utils/bankrun'
import { CreateAccountParams, StakeProgram } from '@solana/web3.js'

describe('Solana stake account behavior verification', () => {
  let provider: BankrunProvider
  let program: ValidatorBondsProgram

  const keypairCreator = Keypair.generate()
  const staker = Keypair.generate()
  const withdrawer = Keypair.generate()

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;({ provider, program } = await initBankrunTest())
  })

  // TODO: #1 when stake account is created with lockup what happens when authority is changed?
  //          will the lockup custodian stays the same as before?
  //          can be lockup removed completely?
  //          what the 'custodian' field on 'authorize' method has the significance for?
  //
  // TODO: #2 check what happens when lockup account is merged with non-lockup account?
  // TODO: #3 what happen after split of stake account with authorities, are they maintained as in the original one?
  it('Create stake account', async () => {
    const createIx = StakeProgram.createAccount({
      fromPubkey: provider.wallet.publicKey,
      stakePubkey: keypairCreator.publicKey,
      authorized: {
        staker: staker.publicKey,
        withdrawer: withdrawer.publicKey,
      },
      lockup: undefined,
      lamports: LAMPORTS_PER_SOL,
    })
    const tx = await bankrunTransaction(provider)
    tx.add(createIx)
    const txOut = await bankrunExecute(provider, tx, [
      provider.wallet,
      keypairCreator,
    ])
  })
})
