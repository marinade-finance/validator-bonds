import { createTempFileKeypair } from '@marinade.finance/web3js-common'
import { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import {
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
} from '@solana/web3.js'

export async function getRentPayer(provider: AnchorExtendedProvider): Promise<{
  path: string
  cleanup: () => Promise<void>
  keypair: Keypair
}> {
  const {
    keypair: rentPayerKeypair,
    path: rentPayerPath,
    cleanup: cleanupRentPayer,
  } = await createTempFileKeypair()
  const rentPayerFunds = 10 * LAMPORTS_PER_SOL
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: provider.walletPubkey,
      toPubkey: rentPayerKeypair.publicKey,
      lamports: rentPayerFunds,
    })
  )
  await provider.sendAndConfirm!(tx)
  await expect(
    provider.connection.getBalance(rentPayerKeypair.publicKey)
  ).resolves.toStrictEqual(rentPayerFunds)
  return {
    keypair: rentPayerKeypair,
    path: rentPayerPath,
    cleanup: cleanupRentPayer,
  }
}
