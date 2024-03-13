import { findConfigStakeAccounts, ValidatorBondsProgram } from '../../src'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '../utils/testTransactions'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { createBondsFundedStakeAccount } from '../utils/staking'
import { ExtendedProvider } from '../utils/provider'
import { initTest, waitForNextEpoch } from './testValidator'

describe('Validator Bonds api call to stake accounts', () => {
  let provider: ExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  const withdrawLockupEpochs = 1

  beforeAll(async () => {
    ;({ provider, program } = await initTest())
  })

  beforeEach(async () => {
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
      withdrawLockupEpochs,
    }))
  })

  it('bond funded stake accounts', async () => {
    const inputData: {
      bondAccount: PublicKey
      voteAccount: PublicKey
      validatorIdentity: Keypair
      stakeAccounts: PublicKey[]
      lamports: number[]
    }[] = []
    const promiseBonds: ReturnType<typeof executeInitBondInstruction>[] = []
    for (let bondCount = 0; bondCount < 100; bondCount++) {
      promiseBonds.push(
        executeInitBondInstruction({
          program,
          provider,
          configAccount,
        })
      )
    }
    ;(await Promise.all(promiseBonds)).forEach(bond => {
      const count = Math.floor(Math.random() * 10) + 1
      const randomLamports = [...Array(count)].map(
        () =>
          2 * LAMPORTS_PER_SOL +
          Math.floor(Math.random() * 100 * LAMPORTS_PER_SOL)
      )
      inputData.push({
        bondAccount: bond.bondAccount,
        voteAccount: bond.voteAccount,
        validatorIdentity: bond.validatorIdentity!,
        stakeAccounts: [],
        lamports: randomLamports,
      })
    })
    const promiseStakeAccounts: Promise<PublicKey>[] = []
    for (let i = 0; i < inputData.length; i++) {
      for (let j = 0; j < inputData[i].lamports.length; j++) {
        promiseStakeAccounts.push(
          createBondsFundedStakeAccount({
            program,
            provider,
            configAccount,
            lamports: inputData[i].lamports[j],
            voteAccount: inputData[i].voteAccount,
          })
        )
      }
    }
    ;(await Promise.all(promiseStakeAccounts)).forEach((stakeAccount, i) => {
      inputData[i % inputData.length].stakeAccounts.push(stakeAccount)
    })
    await waitForNextEpoch(provider.connection, 15) // activate all stake accounts

    const numberStakeAccounts = inputData.reduce(
      (acc, { lamports }) => acc + lamports.length,
      0
    )
    console.log(
      `created ${inputData.length} bonds, ${numberStakeAccounts} stake accounts`
    )
    const stakeAccountsAtConfig = await findConfigStakeAccounts({
      program,
      configAccount,
    })
    expect(stakeAccountsAtConfig.length).toBe(numberStakeAccounts)
  }, 100_000)
})
