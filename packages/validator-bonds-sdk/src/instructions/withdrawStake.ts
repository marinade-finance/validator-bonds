import {
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_STAKE_HISTORY_PUBKEY,
  StakeProgram,
} from '@solana/web3.js'

import { getConfig } from '../api'
import { bondsWithdrawerAuthority, type ValidatorBondsProgram } from '../sdk'

import type { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import type { TransactionInstruction, Keypair, Signer } from '@solana/web3.js'

/**
 * Generate instruction to withdraw lamports from a closed settlement's leftover
 * stake account that is NOT live validator collateral: either `Initialized`
 * (non-delegated), or delegated but fully deactivated and below the minimal
 * delegatable size (cannot be re-delegated/reset). Such accounts are considered
 * operator owned. Active stake, or an inactive stake big enough to be reset,
 * returns to the validator via ResetStake instead.
 * Only operator may call this operation.
 */
export async function withdrawStakeInstruction({
  program,
  stakeAccount,
  settlementAccount,
  configAccount,
  withdrawTo,
  operatorAuthority,
}: {
  program: ValidatorBondsProgram
  stakeAccount: PublicKey
  settlementAccount: PublicKey
  configAccount: PublicKey
  withdrawTo: PublicKey
  operatorAuthority?: PublicKey | Keypair | Signer | WalletInterface // signer
}): Promise<{
  instruction: TransactionInstruction
}> {
  if (operatorAuthority === undefined) {
    const configData = await getConfig(program, configAccount)
    operatorAuthority = configData.operatorAuthority
  }
  operatorAuthority =
    operatorAuthority instanceof PublicKey
      ? operatorAuthority
      : operatorAuthority.publicKey

  const instruction = await program.methods
    .withdrawStake()
    .accountsPartial({
      config: configAccount,
      settlement: settlementAccount,
      bondsWithdrawerAuthority: bondsWithdrawerAuthority(
        configAccount,
        program.programId,
      )[0],
      stakeAccount,
      operatorAuthority,
      withdrawTo,
      stakeHistory: SYSVAR_STAKE_HISTORY_PUBKEY,
      clock: SYSVAR_CLOCK_PUBKEY,
      stakeProgram: StakeProgram.programId,
    })
    .instruction()
  return {
    instruction,
  }
}
