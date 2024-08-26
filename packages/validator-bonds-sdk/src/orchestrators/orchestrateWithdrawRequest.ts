import {
  Keypair,
  PublicKey,
  Signer,
  TransactionInstruction,
} from '@solana/web3.js'
import {
  bondAddress,
  bondsWithdrawerAuthority,
  ValidatorBondsProgram,
  WithdrawRequest,
  withdrawRequestAddress,
} from '../sdk'
import { getBond, getWithdrawRequest } from '../api'
import assert from 'assert'
import { StakeAccountParsed, findStakeAccounts } from '../web3.js'
import BN from 'bn.js'
import { mergeStakeInstruction } from '../instructions/mergeStake'
import { claimWithdrawRequestInstruction } from '../instructions/claimWithdrawRequest'
import { anchorProgramWalletPubkey } from '../utils'
import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import { ProgramAccountInfo } from '@marinade.finance/web3js-common'
import { LoggerPlaceholder, logDebug } from '@marinade.finance/ts-common'

/**
 * Returning the instructions for withdrawing the deposit (on top of the withdraw request)
 * while trying to find right accounts when available and merge them together.
 */
export async function orchestrateWithdrawDeposit({
  program,
  withdrawRequestAccount,
  bondAccount,
  configAccount,
  voteAccount,
  withdrawer,
  authority,
  splitStakeRentPayer = anchorProgramWalletPubkey(program),
  logger,
}: {
  program: ValidatorBondsProgram
  withdrawRequestAccount?: PublicKey
  bondAccount?: PublicKey
  configAccount?: PublicKey
  voteAccount?: PublicKey
  withdrawer?: PublicKey
  authority?: PublicKey | Keypair | Signer | WalletInterface // signer
  splitStakeRentPayer?: PublicKey | Keypair | Signer | WalletInterface // signer
  logger?: LoggerPlaceholder
}): Promise<{
  instructions: TransactionInstruction[]
  withdrawRequestAccount: PublicKey
  splitStakeAccounts: Keypair[] // required signer
  withdrawStakeAccounts: PublicKey[]
}> {
  if (
    configAccount !== undefined &&
    voteAccount !== undefined &&
    bondAccount === undefined
  ) {
    bondAccount = bondAddress(configAccount, voteAccount, program.programId)[0]
  }
  let withdrawRequestData: WithdrawRequest | undefined
  if (bondAccount === undefined && withdrawRequestAccount === undefined) {
    throw new Error(
      'orchestrateWithdrawDeposit: bondAccount and withdrawRequestAccount not provided, ' +
        'at least one has to be provided'
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

  if (configAccount === undefined) {
    const bondData = await getBond(program, bondAccount)
    configAccount = bondData.config
  }

  withdrawRequestData =
    withdrawRequestData ??
    (await getWithdrawRequest(program, withdrawRequestAccount))

  let amountToWithdraw = withdrawRequestData.requestedAmount.sub(
    withdrawRequestData.withdrawnAmount
  )
  amountToWithdraw =
    amountToWithdraw <= new BN(0) ? new BN(0) : amountToWithdraw
  // calculating what are the stake accounts we need to merge to easily withdraw the deposit
  const [bondWithdrawerAuthority] = bondsWithdrawerAuthority(
    configAccount,
    program.programId
  )
  const currentEpoch = (await program.provider.connection.getEpochInfo()).epoch
  const stakeAccountsToWithdraw = (
    await findStakeAccounts({
      connection: program,
      staker: bondWithdrawerAuthority,
      withdrawer: bondWithdrawerAuthority,
      voter: withdrawRequestData.voteAccount,
      currentEpoch,
    })
  )
    .sort((x, y) =>
      x.account.lamports > y.account.lamports
        ? 1
        : x.account.lamports < y.account.lamports
          ? -1
          : 0
    )
    .reduce<{
      stakesAmount: BN
      accounts: ProgramAccountInfo<StakeAccountParsed>[]
    }>(
      (acc, accountInfo) => {
        if (acc.stakesAmount < amountToWithdraw) {
          acc.stakesAmount.add(new BN(accountInfo.account.lamports))
          acc.accounts.push(accountInfo)
        }
        return acc
      },
      {
        stakesAmount: new BN(0),
        accounts: [] as ProgramAccountInfo<StakeAccountParsed>[],
      }
    )

  // there are some stake accounts to withdraw from
  if (stakeAccountsToWithdraw.accounts.length > 0) {
    const instructions: TransactionInstruction[] = []
    const withdrawStakeAccounts: PublicKey[] = []
    const splitStakeAccounts: Keypair[] = []

    const destinationStakeAccount = stakeAccountsToWithdraw.accounts[0]
    // going through from the second item that we want to merge all to the first one
    for (
      let mergeIndex = 1;
      mergeIndex < stakeAccountsToWithdraw.accounts.length;
      mergeIndex++
    ) {
      // merging possible only for the stake accounts of the same state
      const sourceStakeAccount = stakeAccountsToWithdraw.accounts[mergeIndex]

      if (
        isFullyActive(sourceStakeAccount, currentEpoch) ===
          isFullyActive(destinationStakeAccount, currentEpoch) &&
        sourceStakeAccount.account.data.isCoolingDown ===
          destinationStakeAccount.account.data.isCoolingDown
      ) {
        const mergeIx = await mergeStakeInstruction({
          program,
          configAccount,
          sourceStakeAccount: sourceStakeAccount.publicKey,
          destinationStakeAccount: destinationStakeAccount.publicKey,
        })
        logDebug(
          logger,
          `Merging stake account: ${sourceStakeAccount.publicKey.toBase58()} -> ` +
            `${destinationStakeAccount.publicKey.toBase58()}`
        )
        instructions.push(mergeIx.instruction)
      } else {
        // not possible to merge so let's just to try to withdraw directly the stake account
        const withdrawRequest = await claimWithdrawRequestInstruction({
          program,
          configAccount,
          withdrawRequestAccount,
          bondAccount,
          stakeAccount: sourceStakeAccount.publicKey,
          authority,
          voteAccount: withdrawRequestData.voteAccount,
          splitStakeRentPayer,
          withdrawer,
        })
        withdrawStakeAccounts.push(sourceStakeAccount.publicKey)
        splitStakeAccounts.push(withdrawRequest.splitStakeAccount)
        instructions.push(withdrawRequest.instruction)
      }
    }

    // managing the withdraw request for the first stake account in the list
    const withdrawRequest = await claimWithdrawRequestInstruction({
      program,
      configAccount,
      withdrawRequestAccount,
      bondAccount,
      stakeAccount: destinationStakeAccount.publicKey,
      authority,
      voteAccount: withdrawRequestData.voteAccount,
      splitStakeRentPayer,
      withdrawer,
    })
    withdrawStakeAccounts.push(destinationStakeAccount.publicKey)
    splitStakeAccounts.push(withdrawRequest.splitStakeAccount)
    instructions.push(withdrawRequest.instruction)

    return {
      instructions,
      withdrawRequestAccount,
      splitStakeAccounts, // needed to be signers of whole transaction
      withdrawStakeAccounts,
    }
  } else {
    throw new Error(
      'orchestrateWithdrawDeposit: cannot find any stake accounts to withdraw from'
    )
  }
}

function isFullyActive(
  stakeAccount: ProgramAccountInfo<StakeAccountParsed>,
  epoch: BN | number
): boolean {
  return new BN(
    stakeAccount.account.data.activationEpoch || Number.MAX_SAFE_INTEGER
  ).lt(new BN(epoch))
}
