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

/**
 * Generate instruction to cancel withdraw request for bond account.
 * This operation removes the withdraw request account from chain.
 * Only bond authority or validator identity of vote account voter pubkey can do this.
 */
export async function cancelWithdrawRequestInstruction({
  program,
  withdrawRequestAccount,
  bondAccount,
  configAccount,
  voteAccount,
  authority,
  rentCollector = anchorProgramWalletPubkey(program),
}: {
  program: ValidatorBondsProgram
  withdrawRequestAccount?: PublicKey
  bondAccount?: PublicKey
  configAccount?: PublicKey
  voteAccount?: PublicKey
  authority?: PublicKey | Keypair | Signer | WalletInterface // signer
  rentCollector?: PublicKey
}): Promise<{
  instruction: TransactionInstruction
}> {
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
  if (
    configAccount !== undefined &&
    voteAccount !== undefined &&
    bondAccount === undefined
  ) {
    bondAccount = bondAddress(configAccount, voteAccount, program.programId)[0]
  }
  if (bondAccount !== undefined && withdrawRequestAccount === undefined) {
    withdrawRequestAccount = withdrawRequestAddress(
      bondAccount,
      program.programId
    )[0]
  }
  if (
    bondAccount !== undefined &&
    (voteAccount === undefined || authority === undefined)
  ) {
    const bondData = await program.account.bond.fetch(bondAccount)
    voteAccount = bondData.voteAccount
    authority = authority ?? bondData.authority
  }
  authority = authority ?? anchorProgramWalletPubkey(program)
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
      voteAccount,
      authority,
      withdrawRequest: withdrawRequestAccount,
      rentCollector,
    })
    .instruction()
  return {
    instruction,
  }
}
