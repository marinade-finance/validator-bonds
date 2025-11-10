import BN from 'bn.js'

import { bondAddress, bondProductAddress } from './sdk'

import type { ProductType } from './sdk'
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

export function checkAndGetBondAddress({
  bond,
  config,
  voteAccount,
  programId,
}: {
  bond: PublicKey | undefined
  config: PublicKey | undefined
  voteAccount: PublicKey | undefined
  programId?: PublicKey
}): PublicKey {
  if (bond !== undefined) {
    return bond
  } else if (config !== undefined && voteAccount !== undefined) {
    return bondAddress(config, voteAccount, programId)[0]
  } else {
    throw new Error(
      'Either [bondAccount] or [config and voteAccount] is required',
    )
  }
}

export function checkAndGetBondProductAddress({
  bondProduct,
  config,
  bond,
  voteAccount,
  productType,
  programId,
}: {
  bondProduct: PublicKey | undefined
  config: PublicKey | undefined
  bond: PublicKey | undefined
  voteAccount: PublicKey | undefined
  productType: ProductType | undefined
  programId?: PublicKey
}): PublicKey {
  if (bondProduct !== undefined) {
    return bondProduct
  } else if (bond !== undefined && productType !== undefined) {
    return bondProductAddress(bond, productType, programId)[0]
  } else if (
    config !== undefined &&
    voteAccount !== undefined &&
    productType !== undefined
  ) {
    const bond = bondAddress(config, voteAccount, programId)[0]
    return bondProductAddress(bond, productType, programId)[0]
  } else {
    throw new Error(
      'Either [bondProduct] or [bond and productType] or [config, voteAccount and productType] is required',
    )
  }
}

export function toBNPreserve(
  value: number | string | bigint | BN | null,
): BN | null
export function toBNPreserve(
  value: number | string | bigint | BN | null | undefined,
): BN | null | undefined
export function toBNPreserve(
  value: number | string | bigint | BN | undefined,
): BN | undefined
export function toBNPreserve(value: number | string | bigint | BN): BN
export function toBNPreserve(
  value: number | string | bigint | BN | null | undefined,
): BN | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (value instanceof BN) return value
  return new BN(value.toString())
}
