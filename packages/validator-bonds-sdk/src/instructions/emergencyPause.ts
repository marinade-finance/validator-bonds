import {
  Keypair,
  PublicKey,
  Signer,
  TransactionInstruction,
} from '@solana/web3.js'
import { CONFIG_ADDRESS, ValidatorBondsProgram } from '../sdk'
import { getConfig } from '../api'
import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'

/**
 * Generate instruction to pause program.
 * Admin only operation.
 */
export async function emergencyPauseInstruction({
  program,
  configAccount = CONFIG_ADDRESS,
  pauseAuthority,
}: {
  program: ValidatorBondsProgram
  configAccount?: PublicKey
  pauseAuthority?: PublicKey | Keypair | Signer | WalletInterface // signer
}): Promise<{
  instruction: TransactionInstruction
}> {
  if (pauseAuthority === undefined) {
    const configData = await getConfig(program, configAccount)
    pauseAuthority = configData.pauseAuthority
  }
  pauseAuthority =
    pauseAuthority instanceof PublicKey
      ? pauseAuthority
      : pauseAuthority.publicKey

  const instruction = await program.methods
    .emergencyPause()
    .accounts({
      config: configAccount,
      pauseAuthority,
    })
    .instruction()
  return {
    instruction,
  }
}
