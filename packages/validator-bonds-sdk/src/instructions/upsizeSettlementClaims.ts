import { PublicKey } from '@solana/web3.js'

import { settlementClaimsAddress } from '../sdk'
import { anchorProgramWalletPubkey } from '../utils'

import type { ValidatorBondsProgram } from '../sdk'
import type { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import type { Keypair, Signer, TransactionInstruction } from '@solana/web3.js'

/**
 * Generate instruction to increase size of Solana account SettlementClaims.
 * Max Solana account size is 10MB, incremental increase of size is 10KB.
 */
export async function upsizeSettlementClaims({
  program,
  settlementClaimsAccount,
  settlementAccount,
  rentPayer = anchorProgramWalletPubkey(program),
}: {
  program: ValidatorBondsProgram
  settlementClaimsAccount?: PublicKey
  settlementAccount?: PublicKey
  rentPayer?: PublicKey | Keypair | Signer | WalletInterface // signer
}): Promise<{
  instruction: TransactionInstruction
}> {
  const renPayerPubkey =
    rentPayer instanceof PublicKey ? rentPayer : rentPayer.publicKey

  if (!settlementClaimsAccount && !settlementAccount) {
    throw new Error(
      'Cannot get settlement claims account address to be upsized. ' +
        'Provide either settlementClaimsAccount or settlementAccount.'
    )
  }
  if (settlementAccount) {
    const [derivedSettlementClaimsAccount] = settlementClaimsAddress(
      settlementAccount,
      program.programId
    )
    if (
      settlementClaimsAccount &&
      !settlementClaimsAccount.equals(derivedSettlementClaimsAccount)
    ) {
      throw new Error(
        'Provided settlementClaimsAccount does not match derived address from Settlement address.'
      )
    }
    settlementClaimsAccount = derivedSettlementClaimsAccount
  }

  const instruction = await program.methods
    .upsizeSettlementClaims()
    .accounts({
      settlementClaims: settlementClaimsAccount,
      rentPayer: renPayerPubkey,
    })
    .instruction()
  return {
    instruction,
  }
}
