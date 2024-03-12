import { ValidatorBondsProgram, getConfig } from '../../src'
import { BankrunExtendedProvider, delegateAndFund, initBankrunTest } from './bankrun'
import {
  executeFundBondInstruction,
  executeInitConfigInstruction,
} from '../utils/testTransactions'
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'

describe('Validator Bonds api call to stake accounts', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
  })

  beforeEach(async () => {
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
      epochsToClaimSettlement: 1,
      withdrawLockupEpochs: 2,
    }))
    const config = await getConfig(program, configAccount)
    expect(config.epochsToClaimSettlement).toEqual(1)
    expect(config.withdrawLockupEpochs).toEqual(2)
  })

  it('bond funded stake accounts', async () => {
    const inputData: {
      bondAccount: PublicKey
      stakeAccounts: PublicKey[]
      lamports: number[]
    }[] = []
    for (let bondCount = 0; bondCount < 1000; bondCount++) {
      const count = Math.floor(Math.random() * 100) + 1
      const randomLamports = [...Array(count)].map(
        () =>
          2 * LAMPORTS_PER_SOL +
          Math.floor(Math.random() * 100 * LAMPORTS_PER_SOL)
      )
      const { bondAccount, stakeAccounts } =
        await createStakeAccounts(randomLamports)
      inputData.push({ bondAccount, stakeAccounts, lamports: randomLamports })
    }
  })

  async function createStakeAccounts(lamports: number[]): Promise<{
    bondAccount: PublicKey
    voteAccount: PublicKey
    stakeAccounts: PublicKey[]
  }> {
    if (lamports.length === 0) {
      throw new Error('lamports must have at least one element')
    }

    const stakeAccounts: PublicKey[] = []
    const { bondAccount, voteAccount, stakeAccount } =
      await executeFundBondInstruction({
        program,
        provider,
        newStakeAccountLamports: lamports[0],
        configAccount,
      })
    stakeAccounts.push(stakeAccount)
    for (let i = 1; i < lamports.length; i++) {
        delegateAndFund()
      const { stakeAccount } = await executeFundBondInstruction({
        program,
        provider,
        newStakeAccountLamports: lamports[i],
        configAccount,
        bondAccount,
      })
      stakeAccounts.push(stakeAccount)
    }
    return { bondAccount, voteAccount, stakeAccounts }
  }
})
