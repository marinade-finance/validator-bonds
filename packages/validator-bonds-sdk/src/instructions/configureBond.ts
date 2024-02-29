import {
  Keypair,
  PublicKey,
  Signer,
  TransactionInstruction,
} from '@solana/web3.js'
import { ValidatorBondsProgram } from '../sdk'
import { checkAndGetBondAddress, anchorProgramWalletPubkey } from '../utils'
import BN from 'bn.js'
import { getBond } from '../api'
import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'

/**
 * Generate instruction to configure bond account. Signature of validator identity of vote account
 * voter pubkey OR bond authority is required.
 */
export async function configureBondInstruction({
  program,
  bondAccount,
  configAccount,
  voteAccount,
  authority = anchorProgramWalletPubkey(program),
  newBondAuthority,
  newCpmpe,
}: {
  program: ValidatorBondsProgram
  bondAccount?: PublicKey
  configAccount?: PublicKey
  voteAccount?: PublicKey
  authority?: PublicKey | Keypair | Signer | WalletInterface | WalletInterface // signer
  newBondAuthority?: PublicKey
  newCpmpe?: BN | number
}): Promise<{
  bondAccount: PublicKey
  instruction: TransactionInstruction
}> {
  bondAccount = checkAndGetBondAddress(
    bondAccount,
    configAccount,
    voteAccount,
    program.programId
  )
  if (voteAccount === undefined) {
    const bondData = await getBond(program, bondAccount)
    voteAccount = bondData.voteAccount
  }
  authority = authority instanceof PublicKey ? authority : authority.publicKey

  const instruction = await program.methods
    .configureBond({
      bondAuthority: newBondAuthority === undefined ? null : newBondAuthority,
      cpmpe: newCpmpe === undefined ? null : new BN(newCpmpe),
    })
    .accounts({
      bond: bondAccount,
      authority,
      voteAccount,
    })
    .instruction()
  return {
    bondAccount,
    instruction,
  }
}
