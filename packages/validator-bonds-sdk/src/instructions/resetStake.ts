import {
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_STAKE_HISTORY_PUBKEY,
  StakeProgram,
  TransactionInstruction,
  STAKE_CONFIG_ID,
} from '@solana/web3.js'
import { ValidatorBondsProgram } from '../sdk'
import { checkAndGetBondAddress } from '../utils'
import { getBond } from '../api'
import { getStakeAccount } from '../web3.js'

/**
 * Generate instruction to reset stake from closed settlement.
 * This is a permission-less operation.
 * When settlement was closed this brings the stake accounts back
 * to state them being funded to bonds program.
 */
export async function resetStakeInstruction({
  program,
  stakeAccount,
  settlementAccount,
  bondAccount,
  configAccount,
  voteAccount,
}: {
  program: ValidatorBondsProgram
  stakeAccount: PublicKey
  settlementAccount: PublicKey
  bondAccount?: PublicKey
  configAccount?: PublicKey
  voteAccount?: PublicKey
}): Promise<{
  instruction: TransactionInstruction
}> {
  if (voteAccount === undefined) {
    const stakeAccountData = await getStakeAccount(program, stakeAccount, 0)
    if (stakeAccountData.voter === null) {
      throw new Error(
        `Cannot load vote account address from stake account ${stakeAccount.toBase58()}`,
      )
    }
    voteAccount = stakeAccountData.voter
  }
  bondAccount = checkAndGetBondAddress(
    bondAccount,
    configAccount,
    voteAccount,
    program.programId,
  )
  if (configAccount === undefined) {
    const bondData = await getBond(program, bondAccount)
    configAccount = bondData.config
  }

  const instruction = await program.methods
    .resetStake()
    .accounts({
      config: configAccount,
      bond: bondAccount,
      settlement: settlementAccount,
      stakeAccount,
      voteAccount,
      stakeHistory: SYSVAR_STAKE_HISTORY_PUBKEY,
      stakeConfig: STAKE_CONFIG_ID,
      clock: SYSVAR_CLOCK_PUBKEY,
      stakeProgram: StakeProgram.programId,
    })
    .instruction()
  return {
    instruction,
  }
}
