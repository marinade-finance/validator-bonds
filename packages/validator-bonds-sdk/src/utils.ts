import { Program, Idl } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'
import { bondAddress as sdkBondAddress } from './sdk'

export function walletPubkey<IDL extends Idl = Idl>(program: Program<IDL>) {
  const pubkey = program.provider.publicKey
  if (pubkey === undefined) {
    throw new Error(
      'Cannot get wallet pubkey from Anchor Program ' + program.programId
    )
  }
  return pubkey
}

export function checkAndGetBondAddress(
  bond: PublicKey | undefined,
  config: PublicKey | undefined,
  voteAccount: PublicKey | undefined,
  programId?: PublicKey
): PublicKey {
  if (bond !== undefined) {
    return bond
  } else if (config !== undefined && voteAccount !== undefined) {
    return sdkBondAddress(config, voteAccount, programId)[0]
  } else {
    throw new Error(
      'Either [bondAccount] or [validatorVoteAccount and configAccount] is required'
    )
  }
}

/**
 * Convert a number to a bps number which is 10000th of a percent.
 * It's 100th of the basic point number.
 * 1 HundredthBasisPoint = 0.0001%, 10_000 HundredthBasisPoint = 1%, 1_000_000 HundredthBasisPoint = 100%
 */
export function toHundredsBps(value: number | string): number {
  return Math.floor(parseFloat(value.toString()) * 10000)
}
