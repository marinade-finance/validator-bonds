import {
  Keypair,
  PublicKey,
  Signer,
  TransactionInstruction,
} from '@solana/web3.js'
import { MARINADE_CONFIG_ADDRESS, ValidatorBondsProgram } from '../sdk'
import { getConfig } from '../api'
import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import { LoggerPlaceholder, logWarn } from '@marinade.finance/ts-common'

/**
 * Generate instruction to pause program.
 * Admin only operation.
 */
export async function emergencyPauseInstruction({
  program,
  configAccount,
  pauseAuthority,
  logger,
}: {
  program: ValidatorBondsProgram
  configAccount?: PublicKey
  pauseAuthority?: PublicKey | Keypair | Signer | WalletInterface // signer
  logger?: LoggerPlaceholder
}): Promise<{
  instruction: TransactionInstruction
}> {
  if (pauseAuthority === undefined) {
    if (configAccount === undefined) {
      logWarn(
        logger,
        'emergencyPause SDK: config is not provided, using default address: ' +
          MARINADE_CONFIG_ADDRESS.toBase58(),
      )
      configAccount = MARINADE_CONFIG_ADDRESS
    }
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
