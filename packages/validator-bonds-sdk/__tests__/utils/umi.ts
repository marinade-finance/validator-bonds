import { publicKey as umiPublicKey } from '@metaplex-foundation/umi'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { PublicKey } from '@solana/web3.js'

import type { Provider } from '@marinade.finance/web3js-1x'
import type { PublicKey as UmiPublicKey, Umi } from '@metaplex-foundation/umi'

export function fromUmiPubkey(umiPubkey: UmiPublicKey): PublicKey {
  return new PublicKey(umiPubkey.toString())
}

export function toUmiPubkey(pubkey: PublicKey): UmiPublicKey {
  return umiPublicKey(pubkey.toBase58(), true)
}

export function getUmi(provider: Provider): Umi {
  const commitment = provider.connection.commitment ?? 'confirmed'
  return createUmi(provider.connection.rpcEndpoint, {
    getAccountsChunkSize: undefined,
    commitment,
  })
}
