import { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'

import { getBond } from '../api'
import { checkAndGetBondAddress, anchorProgramWalletPubkey } from '../utils'

import type { ValidatorBondsProgram } from '../sdk'
import type { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import type { Keypair, Signer, TransactionInstruction } from '@solana/web3.js'

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
  newMaxStakeWanted,
}: {
  program: ValidatorBondsProgram
  bondAccount?: PublicKey
  configAccount?: PublicKey
  voteAccount?: PublicKey
  authority?: PublicKey | Keypair | Signer | WalletInterface // signer
  newBondAuthority?: PublicKey
  newCpmpe?: BN | number
  newMaxStakeWanted?: BN | number
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
      maxStakeWanted:
        newMaxStakeWanted === undefined ? null : new BN(newMaxStakeWanted),
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
