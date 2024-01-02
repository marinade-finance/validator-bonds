import {
  Keypair,
  PublicKey,
  Signer,
  TransactionInstruction,
} from '@solana/web3.js'
import { ValidatorBondsProgram, withdrawRequestAddress } from '../sdk'
import { checkAndGetBondAddress, walletPubkey } from '../utils'
import BN from 'bn.js'
import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'

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
    validatorVoteAccount,
    program.programId
  )
  if (!validatorVoteAccount || !configAccount) {
    const bondData = await program.account.bond.fetch(bondAccount)
    validatorVoteAccount = validatorVoteAccount || bondData.validatorVoteAccount
    configAccount = configAccount || bondData.config
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
