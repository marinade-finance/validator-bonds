import { ValidatorBondsProgram, getConfig } from '../../src'
import { BankrunExtendedProvider, initBankrunTest } from './bankrun'
import { executeInitConfigInstruction } from '../utils/testTransactions'

describe('Validator Bonds config account tests', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
  })

  it('init config', async () => {
    const { configAccount, adminAuthority, operatorAuthority } =
      await executeInitConfigInstruction({
        program,
        provider,
        epochsToClaimSettlement: 1,
        withdrawLockupEpochs: 2,
      })

    const configData = await getConfig(program, configAccount)
    expect(configData.adminAuthority).toEqual(adminAuthority.publicKey)
    expect(configData.operatorAuthority).toEqual(operatorAuthority.publicKey)
    expect(configData.epochsToClaimSettlement).toEqual(1)
    expect(configData.withdrawLockupEpochs).toEqual(2)
  })
})
