import {
  Keypair,
  PublicKey,
  Signer,
  TransactionInstruction,
} from '@solana/web3.js'
import { ValidatorBondsProgram, withdrawRequestAddress } from '../sdk'
import { checkAndGetBondAddress, walletPubkey } from '../utils'
import BN from 'bn.js'

export async function initWithdrawRequestInstruction({
  program,
  bondAccount,
  configAccount,
  validatorVoteAccount,
  authority = walletPubkey(program),
  rentPayer = walletPubkey(program),
  amount,
}: {
  program: ValidatorBondsProgram
  bondAccount?: PublicKey
  configAccount?: PublicKey
  validatorVoteAccount?: PublicKey
  authority?: PublicKey | Keypair | Signer // signer
  rentPayer?: PublicKey | Keypair | Signer // signer
  amount: BN | number
}): Promise<{
  instruction: TransactionInstruction
  withdrawRequest: PublicKey
}> {
  bondAccount = checkAndGetBondAddress(
    bondAccount,
    configAccount,
    validatorVoteAccount,
    program.programId
  )
  if (!validatorVoteAccount) {
    const bondData = await program.account.bond.fetch(bondAccount)
    validatorVoteAccount = bondData.validatorVoteAccount
  }
  if (!configAccount) {
    const bondData = await program.account.bond.fetch(bondAccount)
    configAccount = bondData.config
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
      validatorVoteAccount,
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
