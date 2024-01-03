import {
  Keypair,
  PublicKey,
  SYSVAR_STAKE_HISTORY_PUBKEY,
  Signer,
  StakeProgram,
  TransactionInstruction,
} from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  WithdrawRequest,
  bondAddress,
  withdrawRequestAddress,
} from '../sdk'
import { getWithdrawRequest } from '../api'
import { getVoteAccount } from '../stakeAccount'
import { walletPubkey } from '../utils'

export async function claimWithdrawRequestInstruction({
  program,
  withdrawRequestAccount,
  bondAccount,
  configAccount,
  validatorVoteAccount,
  stakeAccount,
  splitStakeRentPayer = walletPubkey(program),
  withdrawer,
}: {
  program: ValidatorBondsProgram
  withdrawRequestAccount?: PublicKey
  bondAccount?: PublicKey
  configAccount?: PublicKey
  validatorVoteAccount?: PublicKey
  stakeAccount: PublicKey
  splitStakeRentPayer?: PublicKey | Keypair | Signer // signer
  withdrawer?: PublicKey
}): Promise<{
  instruction: TransactionInstruction
  splitStakeAccount: Keypair
}> {
  if (
    configAccount !== undefined &&
    validatorVoteAccount !== undefined &&
    bondAccount === undefined
  ) {
    bondAccount = bondAddress(
      configAccount,
      validatorVoteAccount,
      program.programId
    )[0]
  }
  let withdrawRequestData: WithdrawRequest | undefined
  if (
    withdrawRequestAccount !== undefined &&
    (bondAccount === undefined || validatorVoteAccount === undefined)
  ) {
    withdrawRequestData = await getWithdrawRequest(
      program,
      withdrawRequestAccount
    )
    bondAccount = bondAccount || withdrawRequestData.bond
    validatorVoteAccount =
      validatorVoteAccount || withdrawRequestData.validatorVoteAccount
  }
  if (bondAccount !== undefined && withdrawRequestAccount === undefined) {
    withdrawRequestAccount = withdrawRequestAddress(
      bondAccount,
      program.programId
    )[0]
  }
  if (
    bondAccount !== undefined &&
    (validatorVoteAccount === undefined || configAccount === undefined)
  ) {
    const bondData = await program.account.bond.fetch(bondAccount)
    validatorVoteAccount = validatorVoteAccount || bondData.validatorVoteAccount
    configAccount = configAccount || bondData.config
  }

  if (withdrawRequestAccount === undefined) {
    throw new Error(
      'withdrawRequestAccount not provided and could not be derived from other parameters'
    )
  }

  if (withdrawer === undefined) {
    withdrawRequestData =
      withdrawRequestData ||
      (await getWithdrawRequest(program, withdrawRequestAccount))
    const voteAccountData = await getVoteAccount(
      program,
      withdrawRequestData.validatorVoteAccount
    )
    withdrawer = voteAccountData.account.data.nodePubkey
  }

  splitStakeRentPayer =
    splitStakeRentPayer instanceof PublicKey
      ? splitStakeRentPayer
      : splitStakeRentPayer.publicKey
  const splitStakeAccount = Keypair.generate()

  const instruction = await program.methods
    .claimWithdrawRequest()
    .accounts({
      config: configAccount,
      bond: bondAccount,
      validatorVoteAccount,
      withdrawRequest: withdrawRequestAccount,
      stakeAccount,
      withdrawer,
      splitStakeAccount: splitStakeAccount.publicKey,
      splitStakeRentPayer,
      stakeHistory: SYSVAR_STAKE_HISTORY_PUBKEY,
      stakeProgram: StakeProgram.programId,
    })
    .instruction()
  return {
    instruction,
    splitStakeAccount,
  }
}
