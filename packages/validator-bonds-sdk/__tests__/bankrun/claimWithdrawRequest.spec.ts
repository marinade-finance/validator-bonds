import {
  Bond,
  Config,
  ValidatorBondsProgram,
  getBond,
  getConfig,
  getWithdrawRequest,
} from '../../src'
import {
  BankrunExtendedProvider,
  initBankrunTest,
  warpToEpoch,
  warpToNextEpoch,
} from './bankrun'
import {
  executeFundBondInstruction,
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitWithdrawRequestInstruction,
} from '../utils/testTransactions'
import { ProgramAccount } from '@coral-xyz/anchor'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { claimWithdrawRequestInstruction } from '../../src/instructions/claimWithdrawRequest'
import { delegatedStakeAccount } from '../utils/staking'
import { checkAnchorErrorMessage } from '../utils/helpers'

describe('Validator Bonds claim withdraw request', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let config: ProgramAccount<Config>
  let bond: ProgramAccount<Bond>
  let validatorIdentity: Keypair
  let voteAccount: PublicKey
  const startUpEpoch = Math.floor(Math.random() * 100) + 100

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
    warpToEpoch(provider, startUpEpoch)
  })

  beforeEach(async () => {
    const { configAccount } = await executeInitConfigInstruction({
      program,
      provider,
      withdrawLockupEpochs: 2,
    })
    config = {
      publicKey: configAccount,
      account: await getConfig(program, configAccount),
    }
    const {
      bondAccount,
      validatorIdentity: nodeIdentity,
      voteAccount: voteAcc,
    } = await executeInitBondInstruction(program, provider, config.publicKey)
    voteAccount = voteAcc
    validatorIdentity = nodeIdentity
    bond = {
      publicKey: bondAccount,
      account: await getBond(program, bondAccount),
    }
  })

  it('claim withdraw request with split stake account created', async () => {
    const { stakeAccount, withdrawer: stakeAccountWithdrawer } =
      await delegatedStakeAccount({
        provider,
        lamports: 4 * LAMPORTS_PER_SOL,
        voteAccountToDelegate: voteAccount,
      })
    await warpToNextEpoch(provider) // activating stake account
    await executeFundBondInstruction({
      program,
      provider,
      bondAccount: bond.publicKey,
      stakeAccount,
      stakeAccountAuthority: stakeAccountWithdrawer,
    })
    const requestedAmount = LAMPORTS_PER_SOL * 2
    const { withdrawRequest } = await executeInitWithdrawRequestInstruction({
      program,
      provider,
      bondAccount: bond.publicKey,
      validatorIdentity,
      // TODO: test that asking for more than available fails
      // TODO: test the amount to be smaller than the minimum (1 SOL + 1) and the split can't happen
      // TODO: test SDK
      // TODO: withdrawing with several different stake accounts
      // TODO: test the merging stake accounts through the orchestrate withdraw request
      // TODO: try to claim all first and then claim more on top of the requested amount
      amount: requestedAmount,
    })
    let withdrawRequestData = await getWithdrawRequest(program, withdrawRequest)
    expect(withdrawRequestData.validatorVoteAccount).toEqual(voteAccount)
    expect(withdrawRequestData.withdrawnAmount).toEqual(0)
    expect(withdrawRequestData.requestedAmount).toEqual(requestedAmount)

    const { instruction, splitStakeAccount } =
      await claimWithdrawRequestInstruction({
        program,
        withdrawRequestAccount: withdrawRequest,
        bondAccount: bond.publicKey,
        stakeAccount,
      })

    // waiting an epoch but not enough to unlock
    await warpToNextEpoch(provider)
    try {
      await provider.sendIx([splitStakeAccount], instruction)
      throw new Error('Expected withdraw request should not be elapsed')
    } catch (err) {
      checkAnchorErrorMessage(err, 6019, 'Withdraw request has not elapsed')
    }

    // withdrawLockupEpochs is 2, then second warp should make the withdraw request unlocked
    await warpToNextEpoch(provider)
    await warpToNextEpoch(provider)
    await provider.sendIx([splitStakeAccount], instruction)

    // withdraw request exists until is cancelled
    withdrawRequestData = await getWithdrawRequest(program, withdrawRequest)
    expect(withdrawRequestData.withdrawnAmount).toEqual(requestedAmount)
    expect(withdrawRequestData.requestedAmount).toEqual(requestedAmount)

    // TODO: finalize checks here
    const originalStakeAccountInfo = await provider.connection.getAccountInfo(
      stakeAccount
    )
    expect(originalStakeAccountInfo?.lamports).toEqual(requestedAmount)
    const splitStakeAccountInfo = await provider.connection.getAccountInfo(
      splitStakeAccount.publicKey
    )
    if (splitStakeAccountInfo === null) {
      throw new Error(
        `claiming split stake account '${splitStakeAccount.publicKey.toBase58()} not found`
      )
    }
    const rentExemptStakeAccount =
      await provider.connection.getMinimumBalanceForRentExemption(
        splitStakeAccountInfo.data.length
      )
    console.log('rentExemptStakeAccount', rentExemptStakeAccount)
    expect(splitStakeAccountInfo.lamports).toEqual(
      requestedAmount + rentExemptStakeAccount
    )
  })

  it('claim withdraw request with stake fulfilling the whole', async () => {
    const { stakeAccount, withdrawer: stakeAccountWithdrawer } =
      await delegatedStakeAccount({
        provider,
        lamports: 2 * LAMPORTS_PER_SOL,
        voteAccountToDelegate: voteAccount,
      })
    await warpToNextEpoch(provider) // activating stake account
    await executeFundBondInstruction({
      program,
      provider,
      bondAccount: bond.publicKey,
      stakeAccount,
      stakeAccountAuthority: stakeAccountWithdrawer,
    })
    const { withdrawRequest } = await executeInitWithdrawRequestInstruction({
      program,
      provider,
      bondAccount: bond.publicKey,
      validatorIdentity,
      amount: LAMPORTS_PER_SOL * 2,
    })
    const withdrawRequestData = await getWithdrawRequest(
      program,
      withdrawRequest
    )
    expect(withdrawRequestData.validatorVoteAccount).toEqual(voteAccount)

    const { instruction, splitStakeAccount } =
      await claimWithdrawRequestInstruction({
        program,
        withdrawRequestAccount: withdrawRequest,
        bondAccount: bond.publicKey,
        stakeAccount,
      })

    // waiting an epoch but not enough to unlock
    await warpToNextEpoch(provider)
    await warpToNextEpoch(provider)
    await warpToNextEpoch(provider)
    await provider.sendIx([splitStakeAccount], instruction)
  })
})
