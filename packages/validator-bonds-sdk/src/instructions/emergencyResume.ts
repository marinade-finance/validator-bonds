import { logWarn } from '@marinade.finance/ts-common'
import { PublicKey } from '@solana/web3.js'

import { getConfig } from '../api'
import { MARINADE_CONFIG_ADDRESS } from '../sdk'

import type { ValidatorBondsProgram } from '../sdk'
import type { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import type { LoggerPlaceholder } from '@marinade.finance/ts-common'
import type { Keypair, Signer, TransactionInstruction } from '@solana/web3.js'

/**
 * Generate instruction to resume program.
 * Admin only operation.
 */
export async function emergencyResumeInstruction({
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
        'emergencyResume SDK: config is not provided, using default address: ' +
          MARINADE_CONFIG_ADDRESS.toBase58()
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
