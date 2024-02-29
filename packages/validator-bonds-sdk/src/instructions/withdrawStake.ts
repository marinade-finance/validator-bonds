import {
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_STAKE_HISTORY_PUBKEY,
  StakeProgram,
  TransactionInstruction,
  Keypair,
  Signer,
} from '@solana/web3.js'
import { ValidatorBondsProgram } from '../sdk'
import { getConfig } from '../api'
import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'

/**
 * Generate instruction to withdraw lamports from stake accounts
 * in `Initialized` state. Non-delegated initialized stake accounts
 * are considered as operator owned.
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
    .accounts({
      config: configAccount,
      settlement: settlementAccount,
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
