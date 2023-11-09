// import { Keypair } from '@solana/web3.js'
// import {
//   ValidatorBondsProgram,
//   getConfig,
//   initConfigInstruction,
// } from '../../src'
// import { BankrunProvider } from 'anchor-bankrun'
// import {
//   bankrunExecute,
//   bankrunTransaction,
//   initBankrunTest,
// } from './utils/bankrun'

describe('Solana stake account behavior verification', () => {
  // let provider: BankrunProvider
  // let program: ValidatorBondsProgram

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    // ;({ provider, program } = await initBankrunTest())
  })

  // TODO: #1 when stake account is created with lockup what happens when authority is changed?
  //          will the lockup custodian stays the same as before?
  //          can be lockup removed completely?
  //          what the 'custodian' field on 'authorize' method has the significance for?
  //
  // TODO: #2 check what happens when lockup account is merged with non-lockup account?
  // TODO: #3 what happen after split of stake account with authorities, are they maintained as in the original one?
  it('', async () => {})
})
