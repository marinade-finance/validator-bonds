import { PublicKey, TransactionInstruction } from '@solana/web3.js'
import {
  CONFIG_ADDRESS,
  ValidatorBondsProgram,
  withdrawerAuthority,
} from '../sdk'
import { getStakeAccount } from '../stakeAccount'

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

  const [bondsAuthority] = withdrawerAuthority(configAccount)

  // TODO: do we want to do double-checking at this level or leave it to the program?
  const sourceStakeData = await getStakeAccount(program, sourceStakeAccount)
  const destinationStakeData = await getStakeAccount(
    program,
    destinationStakeAccount,
    sourceStakeData.currentEpoch
  )
  if (
    !sourceStakeData.staker ||
    !sourceStakeData.staker.equals(bondsAuthority) ||
    !destinationStakeData.staker ||
    !destinationStakeData.staker.equals(bondsAuthority)
  ) {
    throw new Error(
      `Source ${sourceStakeAccount.toBase58()} and/or destination ${destinationStakeAccount.toBase58()} ` +
        'stake account is not managed by the bonds program'
    )
  }

  const instruction = await program.methods
    .merge({
      settlement: settlementAccount,
    })
    .accounts({
      config: configAccount,
      sourceStake: sourceStakeAccount,
      destinationStake: destinationStakeAccount,
      stakerAuthority: bondsAuthority,
    })
    .instruction()

  return {
    instruction,
  }
}
