import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import {
  PublicKey as UmiPublicKey,
  publicKey as umiPublicKey,
  Umi,
} from '@metaplex-foundation/umi'
import { PublicKey } from '@solana/web3.js'
import { Provider } from '@marinade.finance/web3js-common'

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
