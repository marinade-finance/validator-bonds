import {
  Keypair,
  PublicKey,
  Signer,
  TransactionInstruction,
} from '@solana/web3.js'
import { ValidatorBondsProgram, withdrawRequestAddress } from '../sdk'
import { checkAndGetBondAddress, anchorProgramWalletPubkey } from '../utils'
import BN from 'bn.js'
import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'

/**
 * Generate instruction to create withdraw request for bond account.
 * Only bond authority or validator identity of vote account voter pubkey can create this request.
 * Only a single withdraw request per bond can be created.
 * The amount can be withdrawn when lockup time elapses (configured in config).
 * When created with a wrong amount then cancel first the request and init a new one.
 * The amount in lamports subtracted from the calculated amount funded to bond.
 */
export async function initWithdrawRequestInstruction({
  program,
  bondAccount,
  configAccount,
  voteAccount,
  authority = anchorProgramWalletPubkey(program),
  rentPayer = anchorProgramWalletPubkey(program),
  amount,
}: {
  program: ValidatorBondsProgram
  bondAccount?: PublicKey
  configAccount?: PublicKey
  voteAccount?: PublicKey
  authority?: PublicKey | Keypair | Signer | WalletInterface // signer
  rentPayer?: PublicKey | Keypair | Signer | WalletInterface // signer
  amount: BN | number
}): Promise<{
  instruction: TransactionInstruction
  withdrawRequestAccount: PublicKey
}> {
  bondAccount = checkAndGetBondAddress(
    bondAccount,
    configAccount,
    voteAccount,
    program.programId
  )
  if (!voteAccount || !configAccount) {
    const bondData = await program.account.bond.fetch(bondAccount)
    voteAccount = voteAccount ?? bondData.voteAccount
    configAccount = configAccount ?? bondData.config
  }

  authority = authority instanceof PublicKey ? authority : authority.publicKey
  rentPayer = rentPayer instanceof PublicKey ? rentPayer : rentPayer.publicKey
  const [withdrawRequest] = withdrawRequestAddress(
    bondAccount,
    program.programId
  )

  const instruction = await program.methods
    .initWithdrawRequest({
      amount: new BN(amount),
    })
    .accounts({
      config: configAccount,
      bond: bondAccount,
      voteAccount,
      withdrawRequest,
      authority,
      rentPayer,
    })
    .instruction()
  return {
    withdrawRequestAccount: withdrawRequest,
    instruction,
  }
}
