import {
  Keypair,
  PublicKey,
  Signer,
  TransactionInstruction,
} from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  WithdrawRequest,
  bondAddress,
  withdrawRequestAddress,
} from '../sdk'
import { anchorProgramWalletPubkey } from '../utils'
import { getWithdrawRequest } from '../api'
import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'

export async function cancelWithdrawRequestInstruction({
  program,
  withdrawRequestAccount,
  bondAccount,
  configAccount,
  validatorVoteAccount,
  authority,
  rentCollector = anchorProgramWalletPubkey(program),
}: {
  program: ValidatorBondsProgram
  withdrawRequestAccount?: PublicKey
  bondAccount?: PublicKey
  configAccount?: PublicKey
  validatorVoteAccount?: PublicKey
  authority?: PublicKey | Keypair | Signer | WalletInterface // signer
  rentCollector?: PublicKey
}): Promise<{
  instruction: TransactionInstruction
}> {
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
  if (bondAccount !== undefined && withdrawRequestAccount === undefined) {
    withdrawRequestAccount = withdrawRequestAddress(
      bondAccount,
      program.programId
    )[0]
  }
  if (
    bondAccount !== undefined &&
    (validatorVoteAccount === undefined || authority === undefined)
  ) {
    const bondData = await program.account.bond.fetch(bondAccount)
    validatorVoteAccount = bondData.validatorVoteAccount
    authority = authority || bondData.authority
  }
  authority = authority || anchorProgramWalletPubkey(program)
  authority = authority instanceof PublicKey ? authority : authority.publicKey

  if (withdrawRequestAccount === undefined) {
    throw new Error(
      'withdrawRequestAccount not provided and could not be derived from other parameters'
    )
  }

  const instruction = await program.methods
    .cancelWithdrawRequest()
    .accounts({
      bond: bondAccount,
      validatorVoteAccount,
      authority,
      withdrawRequest: withdrawRequestAccount,
      rentCollector,
    })
    .instruction()
  return {
    instruction,
  }
}
