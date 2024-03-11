import {
  Keypair,
  PublicKey,
  Signer,
  TransactionInstruction,
} from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  WithdrawRequest,
  withdrawRequestAddress,
} from '../sdk'
import { getBond, getWithdrawRequest } from '../api'
import assert from 'assert'
import { StakeAccountParsed, findStakeAccount } from '../web3.js/stakeAccount'
import BN from 'bn.js'
import { mergeStakeInstruction } from '../instructions/mergeStake'
import { claimWithdrawRequestInstruction } from '../instructions/claimWithdrawRequest'
import { anchorProgramWalletPubkey } from '../utils'
import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import { getVoteAccount } from '../web3.js/index'
import { ProgramAccountInfo } from '../web3.js/accounts'

/**
 * Returning the instructions for withdrawing the deposit (on top of the withdraw request)
 * while trying to find right accounts when available and merge them together.
 */
export async function orchestrateWithdrawDeposit({
  program,
  withdrawRequestAccount,
  bondAccount,
  splitStakeRentPayer = anchorProgramWalletPubkey(program),
}: {
  program: ValidatorBondsProgram
  withdrawRequestAccount?: PublicKey
  bondAccount?: PublicKey
  splitStakeRentPayer?: PublicKey | Keypair | Signer | WalletInterface // signer
}): Promise<{
  instructions: TransactionInstruction[]
  splitStakeAccount: Keypair | undefined // signer
}> {
  let withdrawRequestData: WithdrawRequest | undefined
  if (bondAccount === undefined && withdrawRequestAccount === undefined) {
    throw new Error(
      'bondAccount and withdrawRequestAccount not provided, at least one has to be provided'
    )
  } else if (
    bondAccount === undefined &&
    withdrawRequestAccount !== undefined
  ) {
    withdrawRequestData = await getWithdrawRequest(
      program,
      withdrawRequestAccount
    )
    bondAccount = withdrawRequestData.bond
  } else if (
    bondAccount !== undefined &&
    withdrawRequestAccount === undefined
  ) {
    withdrawRequestAccount = withdrawRequestAddress(
      bondAccount,
      program.programId
    )[0]
  }
  assert(
    withdrawRequestAccount !== undefined,
    'this should not happen; withdrawRequestAccount is undefined'
  )
  assert(
    bondAccount !== undefined,
    'this should not happen; bondAccount is undefined'
  )

  withdrawRequestData =
    withdrawRequestData ??
    (await getWithdrawRequest(program, withdrawRequestAccount))
  const bondData = await getBond(program, bondAccount)
  const voteAccountData = await getVoteAccount(
    program,
    withdrawRequestData.voteAccount
  )
  const withdrawer = voteAccountData.account.data.nodePubkey
  const configAccount = bondData.config

  let amountToWithdraw = withdrawRequestData.requestedAmount.sub(
    withdrawRequestData.withdrawnAmount
  )
  amountToWithdraw =
    amountToWithdraw <= new BN(0) ? new BN(0) : amountToWithdraw
  const stakeAccountsToWithdraw = (
    await findStakeAccount({
      connection: program,
      staker: withdrawer,
      withdrawer,
    })
  )
    .sort((x, y) =>
      x.account.lamports > y.account.lamports
        ? 1
        : x.account.lamports < y.account.lamports
        ? -1
        : 0
    )
    .reduce<[BN, ProgramAccountInfo<StakeAccountParsed>[]]>(
      (acc, accountInfo) => {
        if (acc[0] < amountToWithdraw) {
          acc[0].add(new BN(accountInfo.account.lamports))
          acc[1].push(accountInfo)
        }
        return acc
      },
      [new BN(0), []]
    )

  const instructions: TransactionInstruction[] = []
  let splitStakeAccount: Keypair | undefined = undefined

  // there are some stake accounts to withdraw from
  if (stakeAccountsToWithdraw[1].length > 0) {
    const destinationStakeAccount = stakeAccountsToWithdraw[1][0].publicKey
    // going through from the second item that we want to merge all to the first one
    for (
      let mergeIndex = 1;
      mergeIndex < stakeAccountsToWithdraw.length;
      mergeIndex++
    ) {
      const sourceStakeAccount =
        stakeAccountsToWithdraw[1][mergeIndex].publicKey
      const mergeIx = await mergeStakeInstruction({
        program,
        configAccount,
        sourceStakeAccount,
        destinationStakeAccount,
      })
      instructions.push(mergeIx.instruction)
    }
    const withdrawDeposit = await claimWithdrawRequestInstruction({
      program,
      configAccount,
      withdrawRequestAccount,
      bondAccount,
      stakeAccount: destinationStakeAccount,
      voteAccount: withdrawRequestData.voteAccount,
      splitStakeRentPayer,
      withdrawer,
    })
    instructions.push(withdrawDeposit.instruction)
    splitStakeAccount = withdrawDeposit.splitStakeAccount
  }

  return {
    instructions,
    splitStakeAccount, // needed as a signer for the transaction
  }
}
