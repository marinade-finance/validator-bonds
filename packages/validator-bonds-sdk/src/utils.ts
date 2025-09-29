import { bondAddress as sdkBondAddress } from './sdk'

import type { Program, Idl } from '@coral-xyz/anchor'
import type { PublicKey } from '@solana/web3.js'

// available at @marinade.finance/anchor-common
export function anchorProgramWalletPubkey<IDL extends Idl = Idl>(
  program: Program<IDL>,
) {
  const pubkey = program.provider.publicKey
  if (pubkey === undefined) {
    throw new Error(
      'Cannot get wallet pubkey from Anchor Program ' +
        program.programId.toBase58(),
    )
  }
  return pubkey
}

export function checkAndGetBondAddress(
  bond: PublicKey | undefined,
  config: PublicKey | undefined,
  voteAccount: PublicKey | undefined,
  programId?: PublicKey,
): PublicKey {
  if (bond !== undefined) {
    return bond
  } else if (config !== undefined && voteAccount !== undefined) {
    return sdkBondAddress(config, voteAccount, programId)[0]
  } else {
    throw new Error(
      'Either [bondAccount] or [voteAccount and configAccount] is required',
    )
  }
}
