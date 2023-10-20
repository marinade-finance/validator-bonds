import { Keypair } from '@solana/web3.js'
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

describe('Validator Bonds config account tests', () => {
  let provider: BankrunProvider
  let program: ValidatorBondsProgram

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;({ provider, program } = await initBankrunTest())
  })

  it('init config', async () => {
    const adminAuthority = Keypair.generate().publicKey
    const operatorAuthority = Keypair.generate().publicKey
    expect(adminAuthority).not.toEqual(operatorAuthority)

    const tx = await bankrunTransaction(provider)

    const { keypair, instruction } = await initConfigInstruction({
      program,
      adminAuthority,
      operatorAuthority,
      claimSettlementAfterEpochs: 1,
      withdrawLockupEpochs: 2,
    })
    tx.add(instruction)
    await bankrunExecute(provider, tx, [provider.wallet, keypair!])

    // Ensure the account was created
    const configAccountAddress = keypair!.publicKey
    const configData = await getConfig(program, configAccountAddress)

    expect(configData.adminAuthority).toEqual(adminAuthority)
    expect(configData.operatorAuthority).toEqual(operatorAuthority)
    expect(configData.claimSettlementAfterEpochs).toEqual(1)
    expect(configData.withdrawLockupEpochs).toEqual(2)
  })
})
