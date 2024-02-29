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
 * Generate instruction to resume program.
 * Admin only operation.
 */
export async function emergencyResumeInstruction({
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
    .emergencyResume()
    .accounts({
      config: configAccount,
      pauseAuthority,
    })
    .instruction()
  return {
    instruction,
  }
}
