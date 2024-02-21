import {
  PublicKey,
  SYSVAR_STAKE_HISTORY_PUBKEY,
  StakeProgram,
  TransactionInstruction,
} from '@solana/web3.js'
import { ValidatorBondsProgram, withdrawerAuthority } from '../sdk'

export async function mergeStakeInstruction({
  program,
  configAccount,
  sourceStakeAccount,
  destinationStakeAccount,
  settlementAccount = PublicKey.default,
  stakerAuthority,
}: {
  program: ValidatorBondsProgram
  configAccount: PublicKey
  sourceStakeAccount: PublicKey
  destinationStakeAccount: PublicKey
  settlementAccount?: PublicKey
  stakerAuthority?: PublicKey
}): Promise<{
  instruction: TransactionInstruction
}> {
  // TODO: settlement management
  //       idea of the merge instruction is to merge two stake accounts owned by bonds program
  //       stake account staker authority can be either bond managed or settlement managed
  //       it would be good to check settlements automatically by searching all settlements of the bond and validator
  //       and make sdk to find the right settlement to use when the settlement pubkey is not provided as param
  stakerAuthority = stakerAuthority ?? withdrawerAuthority(configAccount)[0]

  const instruction = await program.methods
    .mergeStake({
      settlement: settlementAccount,
    })
    .accounts({
      config: configAccount,
      sourceStake: sourceStakeAccount,
      destinationStake: destinationStakeAccount,
      stakerAuthority,
      stakeHistory: SYSVAR_STAKE_HISTORY_PUBKEY,
      stakeProgram: StakeProgram.programId,
    })
    .instruction()

  return {
    instruction,
  }
}
