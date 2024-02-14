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
  withdrawRequest: PublicKey
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
    withdrawRequest,
    instruction,
  }
}
