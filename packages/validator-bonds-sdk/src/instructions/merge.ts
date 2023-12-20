import {
  PublicKey,
  SYSVAR_STAKE_HISTORY_PUBKEY,
  StakeProgram,
  TransactionInstruction,
} from '@solana/web3.js'
import {
  CONFIG_ADDRESS,
  ValidatorBondsProgram,
  withdrawerAuthority,
} from '../sdk'

export async function mergeInstruction({
  program,
  configAccount = CONFIG_ADDRESS,
  sourceStakeAccount,
  destinationStakeAccount,
  settlementAccount = PublicKey.default,
}: {
  program: ValidatorBondsProgram
  configAccount?: PublicKey
  sourceStakeAccount: PublicKey
  destinationStakeAccount: PublicKey
  settlementAccount?: PublicKey
}): Promise<{
  instruction: TransactionInstruction
}> {
  // TODO: settlement management
  //       idea of the merge instruction is to merge two stake accounts owned by bonds program
  //       stake account staker authority can be either bond managed or settlement managed
  //       it would be good to check settlements automatically by searching all settlements of the bond and validator
  //       and make sdk to find the right settlement to use when the settlement pubkey is not provided as param
  const [bondsWithdrawerAuthority] = withdrawerAuthority(configAccount)

  const instruction = await program.methods
    .merge({
      settlement: settlementAccount,
    })
    .accounts({
      config: configAccount,
      sourceStake: sourceStakeAccount,
      destinationStake: destinationStakeAccount,
      stakerAuthority: bondsWithdrawerAuthority,
      stakeHistory: SYSVAR_STAKE_HISTORY_PUBKEY,
      stakeProgram: StakeProgram.programId,
    })
    .instruction()

  return {
    instruction,
  }
}
