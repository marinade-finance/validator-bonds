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

export async function resetInstruction({
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
    const stakeAccountData = await getStakeAccount(program, stakeAccount)
    if (stakeAccountData.voter === null) {
      throw new Error(
        `Cannot load vote account address from stake account ${stakeAccount.toBase58()}`
      )
    }
    voteAccount = stakeAccountData.voter
  }
  bondAccount = checkAndGetBondAddress(
    bondAccount,
    configAccount,
    voteAccount,
    program.programId
  )
  if (configAccount === undefined) {
    const bondData = await getBond(program, bondAccount)
    configAccount = bondData.config
  }

  const instruction = await program.methods
    .reset()
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
