import {
  getBondsFunding,
  findBonds,
  findConfigStakeAccounts,
  ValidatorBondsProgram,
  bondsWithdrawerAuthority,
  getStakeAccount,
} from '../../src'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
  executeInitWithdrawRequestInstruction,
} from '../utils/testTransactions'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  authorizeStakeAccount,
  createBondsFundedStakeAccount,
  createInitializedStakeAccount,
  delegatedStakeAccount,
  setLockup,
  createSettlementFundedDelegatedStake,
} from '../utils/staking'
import {
  ExtendedProvider,
  waitForNextEpoch,
} from '@marinade.finance/web3js-common'
import { initTest } from './testValidator'
import { rand } from '@marinade.finance/ts-common'
import { BN } from 'bn.js'
import { pubkey, signer } from '@marinade.finance/web3js-common'
import { getSecureRandomInt } from '../utils/helpers'

describe('Validator Bonds api call to stake accounts', () => {
  const NUMBER_OF_BONDS = 100
  let provider: ExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let operatorAuthority: Keypair
  const withdrawLockupEpochs = 1

  beforeAll(async () => {
    ;({ provider, program } = await initTest())
  })

  beforeEach(async () => {
    ;({ configAccount, operatorAuthority } = await executeInitConfigInstruction(
      {
        program,
        provider,
        withdrawLockupEpochs,
      },
    ))
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
    for (let bondCount = 0; bondCount < NUMBER_OF_BONDS; bondCount++) {
      promiseBonds.push(
        executeInitBondInstruction({
          program,
          provider,
          configAccount,
        }),
      )
    }
    ;(await Promise.all(promiseBonds)).forEach(bond => {
      const count = rand(5)
      const randomLamports = [...Array(count)].map(() =>
        getSecureRandomInt(2 * LAMPORTS_PER_SOL, 100 * LAMPORTS_PER_SOL),
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
          }),
        )
      }
    }
    ;(await Promise.all(promiseStakeAccounts)).forEach((stakeAccount, i) => {
      inputData[i % inputData.length].stakeAccounts.push(stakeAccount)
    })
    await waitForNextEpoch(provider.connection, 15) // activate all stake accounts
    expect(promiseBonds.length).toEqual(NUMBER_OF_BONDS)

    const [withdrawerAuthority] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
    )
    const randomIndex = rand(inputData.length) - 1
    const randomStakeAccount = await getStakeAccount(
      program,
      inputData[randomIndex].stakeAccounts[0],
    )
    expect(randomStakeAccount.withdrawer).toEqual(withdrawerAuthority)
    expect(randomStakeAccount.staker).toEqual(withdrawerAuthority)

    // adding stake accounts that cannot be considered as funded
    // Initialized
    const {
      stakeAccount: initializedStakeAccount,
      withdrawer: initializedWithdrawer,
    } = await createInitializedStakeAccount({
      provider,
      rentExempt: 10 * LAMPORTS_PER_SOL,
    })
    await authorizeStakeAccount({
      provider,
      authority: signer(initializedWithdrawer),
      stakeAccount: initializedStakeAccount,
      withdrawer: withdrawerAuthority,
      staker: withdrawerAuthority,
    })
    // Locked
    const { stakeAccount: delStakeAccount, withdrawer: delWithdrawer } =
      await delegatedStakeAccount({
        provider,
        voteAccountToDelegate: inputData[randomIndex].voteAccount,
        lamports: LAMPORTS_PER_SOL * 3,
      })
    const custodian = Keypair.generate()
    const lockupTx = setLockup({
      stakePubkey: delStakeAccount,
      authorizedPubkey: pubkey(delWithdrawer),
      custodian: custodian.publicKey,
      epoch: Number.MAX_SAFE_INTEGER,
    })
    await provider.sendIx([delWithdrawer], lockupTx)
    await authorizeStakeAccount({
      provider,
      authority: delWithdrawer,
      stakeAccount: delStakeAccount,
      withdrawer: withdrawerAuthority,
      staker: withdrawerAuthority,
      custodian: custodian,
    })

    const numberStakeAccounts = inputData.reduce(
      (acc, { lamports }) => acc + lamports.length,
      0,
    )
    const lamportsStakeAccounts = inputData.reduce(
      (acc, { lamports }) => acc + lamports.reduce((a, b) => a + b, 0),
      0,
    )
    console.log(
      `created ${inputData.length} bonds, ${numberStakeAccounts} stake accounts, ` +
        `${lamportsStakeAccounts} lamports`,
    )
    const stakeAccountsAtConfig = await findConfigStakeAccounts({
      program,
      configAccount,
    })
    // +1 is for the initialized state stake account
    expect(stakeAccountsAtConfig.length).toEqual(numberStakeAccounts + 1)

    const bondsData = await findBonds({
      program,
      configAccount,
    })
    const bondAccounts = bondsData.map(bondData => bondData.publicKey)
    const voteAccounts = bondsData.map(bondData => bondData.account.voteAccount)
    const bondsFunding = await getBondsFunding({
      program,
      configAccount,
      bondAccounts,
      voteAccounts,
    })
    expect(bondsFunding.length).toEqual(bondAccounts.length)
    expect(bondsFunding.length).toEqual(NUMBER_OF_BONDS)

    let {
      amountActive,
      amountAtSettlements,
      amountToWithdraw,
      expectedAmountToWithdraw,
    } = await calculateFunding(
      program,
      configAccount,
      bondAccounts,
      voteAccounts,
    )
    expect(amountActive).toEqual(lamportsStakeAccounts)
    expect(amountToWithdraw).toEqual(0)
    expect(amountToWithdraw).toEqual(expectedAmountToWithdraw)
    expect(amountAtSettlements).toEqual(0)

    const withdrawRequests: {
      withdrawRequestAccount: PublicKey
      amount: number
    }[] = []
    let totalWithdrawRequestAmount = 0
    for (let i = 0; i < inputData.length; i += 2) {
      const amount = rand(100) * LAMPORTS_PER_SOL
      const { withdrawRequestAccount } =
        await executeInitWithdrawRequestInstruction({
          program,
          provider,
          configAccount,
          bondAccount: inputData[i].bondAccount,
          validatorIdentity: inputData[i].validatorIdentity,
          amount,
        })
      withdrawRequests.push({ withdrawRequestAccount, amount })
      totalWithdrawRequestAmount += amount
    }

    ;({
      amountActive,
      amountAtSettlements,
      amountToWithdraw,
      expectedAmountToWithdraw,
    } = await calculateFunding(
      program,
      configAccount,
      bondAccounts,
      voteAccounts,
    ))
    expect(amountActive).toEqual(
      lamportsStakeAccounts - totalWithdrawRequestAmount,
    )
    expect(amountToWithdraw).toEqual(expectedAmountToWithdraw)
    expect(amountAtSettlements).toEqual(0)

    const { settlementAccount } = await executeInitSettlement({
      program,
      provider,
      voteAccount: randomStakeAccount.voter!,
      configAccount,
      bondAccount: inputData[randomIndex].bondAccount,
      operatorAuthority,
    })
    const settlementLamports = 10 * LAMPORTS_PER_SOL
    await createSettlementFundedDelegatedStake({
      program,
      provider,
      configAccount,
      settlementAccount,
      voteAccount: randomStakeAccount.voter!,
      lamports: settlementLamports,
    })
    ;({
      amountActive,
      amountAtSettlements,
      amountToWithdraw,
      expectedAmountToWithdraw,
    } = await calculateFunding(
      program,
      configAccount,
      bondAccounts,
      voteAccounts,
    ))
    expect(amountActive).toEqual(
      lamportsStakeAccounts - totalWithdrawRequestAmount,
    )
    expect(amountToWithdraw).toEqual(expectedAmountToWithdraw)
    expect(amountAtSettlements).toEqual(settlementLamports)
  })
})

async function calculateFunding(
  program: ValidatorBondsProgram,
  configAccount: PublicKey,
  bondAccounts: PublicKey[],
  voteAccounts: PublicKey[],
) {
  const bondsFundingWithWithdraws = await getBondsFunding({
    program,
    configAccount,
    bondAccounts,
    voteAccounts,
  })
  const amountActive = bondsFundingWithWithdraws.reduce(
    (acc, { amountActive }) => acc.add(amountActive),
    new BN(0),
  )
  const amountToWithdraw = bondsFundingWithWithdraws.reduce(
    (acc, { amountToWithdraw }) => acc.add(amountToWithdraw),
    new BN(0),
  )
  const amountAtSettlements = bondsFundingWithWithdraws.reduce(
    (acc, { amountAtSettlements }) => acc.add(amountAtSettlements),
    new BN(0),
  )
  const expectedAmountToWithdraw = bondsFundingWithWithdraws.reduce(
    (acc, { amountActive, amountFundedAtBond, amountToWithdraw }) => {
      if (amountActive.isNeg()) {
        return acc.add(amountFundedAtBond)
      } else {
        return acc.add(amountToWithdraw)
      }
    },
    new BN(0),
  )
  return {
    amountActive,
    amountToWithdraw,
    expectedAmountToWithdraw,
    amountAtSettlements,
  }
}
