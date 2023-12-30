import * as anchor from '@coral-xyz/anchor'
import { AnchorProvider } from '@coral-xyz/anchor'
import {
  ValidatorBondsProgram,
  getProgram,
} from '@marinade.finance/validator-bonds-sdk'
import { AnchorExtendedProvider } from '@marinade.finance/validator-bonds-sdk/__tests__/test-validator/testValidator'
import { createTempFileKeypair } from '@marinade.finance/web3js-common'
import {
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
} from '@solana/web3.js'

export async function initTest(): Promise<{
  program: ValidatorBondsProgram
  provider: AnchorProvider
}> {
  if (process.env.ANCHOR_PROVIDER_URL?.includes('localhost')) {
    // workaround to: https://github.com/coral-xyz/anchor/pull/2725
    process.env.ANCHOR_PROVIDER_URL = 'http://127.0.0.1:8899'
  }
  const provider = AnchorProvider.env() as anchor.AnchorProvider
  provider.opts.skipPreflight = true
  return { program: getProgram(provider), provider }
}

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
