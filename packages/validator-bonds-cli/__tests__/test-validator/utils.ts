import { createTempFileKeypair } from '@marinade.finance/web3js-1x'
import { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
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
    }),
  )
  await provider.sendAndConfirm!(tx)
  expect(
    await provider.connection.getBalance(rentPayerKeypair.publicKey),
  ).toStrictEqual(rentPayerFunds)
  return {
    keypair: rentPayerKeypair,
    path: rentPayerPath,
    cleanup: cleanupRentPayer,
  }
}

export async function airdrop(
  connection: Connection,
  publicKey: PublicKey,
  amount: number = LAMPORTS_PER_SOL,
): Promise<void> {
  const signature = await connection.requestAirdrop(publicKey, amount)
  await connection.confirmTransaction(signature, 'confirmed')
  const account = await connection.getAccountInfo(publicKey)
  if (!account) {
    throw new Error(`Account ${publicKey} not found after airdrop`)
  }
}
