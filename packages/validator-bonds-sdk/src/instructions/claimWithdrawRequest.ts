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
  MARINADE_CONFIG_ADDRESS,
} from '../sdk'
import { getBond, getWithdrawRequest } from '../api'
import { getVoteAccount } from '../web3.js/voteAccount'
import { anchorProgramWalletPubkey, checkAndGetBondAddress } from '../utils'
import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'

/**
 * Generate instruction to withdraw amount defined within the withdraw request.
 * Only bond authority or validator identity of vote account voter pubkey can do this.
 * Withdrawing requires stake account that is attributed to the withdrawer.
 * Withdrawing is possible only when lockup time elapses (configured in config)
 * from the withdraw request creation.
 */
export async function claimWithdrawRequestInstruction({
  program,
  withdrawRequestAccount,
  bondAccount,
  configAccount,
  voteAccount,
  stakeAccount,
  authority = anchorProgramWalletPubkey(program),
  splitStakeRentPayer = anchorProgramWalletPubkey(program),
  withdrawer,
}: {
  program: ValidatorBondsProgram
  withdrawRequestAccount?: PublicKey
  bondAccount?: PublicKey
  configAccount?: PublicKey
  voteAccount?: PublicKey
  stakeAccount: PublicKey
  authority?: PublicKey | Keypair | Signer | WalletInterface // signer
  splitStakeRentPayer?: PublicKey | Keypair | Signer | WalletInterface // signer
  withdrawer?: PublicKey
}): Promise<{
  instruction: TransactionInstruction
  splitStakeAccount: Keypair
  withdrawRequestAccount: PublicKey
}> {
  if (
    configAccount !== undefined &&
    voteAccount !== undefined &&
    bondAccount === undefined
  ) {
    bondAccount = bondAddress(configAccount, voteAccount, program.programId)[0]
  }
  let withdrawRequestData: WithdrawRequest | undefined
  if (
    withdrawRequestAccount !== undefined &&
    (bondAccount === undefined || voteAccount === undefined)
  ) {
    withdrawRequestData = await getWithdrawRequest(
      program,
      withdrawRequestAccount
    )
    bondAccount = bondAccount ?? withdrawRequestData.bond
    voteAccount = voteAccount ?? withdrawRequestData.voteAccount
  }
  if (bondAccount !== undefined && withdrawRequestAccount === undefined) {
    withdrawRequestAccount = withdrawRequestAddress(
      bondAccount,
      program.programId
    )[0]
  }
  if (
    bondAccount !== undefined &&
    (voteAccount === undefined || configAccount === undefined)
  ) {
    const bondData = await getBond(program, bondAccount)
    voteAccount = voteAccount ?? bondData.voteAccount
    configAccount = configAccount ?? bondData.config
  }

  if (voteAccount === undefined) {
    throw new Error(
      'voteAccount not provided and could not be derived from other parameters'
    )
  }
  if (withdrawRequestAccount === undefined) {
    throw new Error(
      'claimWithdrawRequest: ' +
        'withdrawRequestAccount not provided and could not be derived from other parameters'
    )
  }
  if (!bondAccount && !configAccount) {
    configAccount = MARINADE_CONFIG_ADDRESS
  }
  bondAccount = checkAndGetBondAddress(
    bondAccount,
    configAccount,
    voteAccount,
    program.programId
  )

  if (withdrawer === undefined) {
    withdrawRequestData =
      withdrawRequestData ??
      (await getWithdrawRequest(program, withdrawRequestAccount))
    const voteAccountData = await getVoteAccount(
      program,
      withdrawRequestData.voteAccount
    )
    withdrawer = voteAccountData.account.data.nodePubkey
  }

  authority = authority instanceof PublicKey ? authority : authority.publicKey
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
      voteAccount,
      withdrawRequest: withdrawRequestAccount,
      stakeAccount,
      withdrawer,
      splitStakeAccount: splitStakeAccount.publicKey,
      authority,
      splitStakeRentPayer,
      stakeHistory: SYSVAR_STAKE_HISTORY_PUBKEY,
      stakeProgram: StakeProgram.programId,
    })
    .instruction()
  return {
    instruction,
    withdrawRequestAccount,
    splitStakeAccount,
  }
}
