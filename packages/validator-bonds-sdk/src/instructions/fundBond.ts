import {
  Keypair,
  PublicKey,
  SYSVAR_STAKE_HISTORY_PUBKEY,
  Signer,
  StakeProgram,
  TransactionInstruction,
} from '@solana/web3.js'
import { ValidatorBondsProgram } from '../sdk'
import { checkAndGetBondAddress, walletPubkey } from '../utils'
import { getBond } from '../api'

export async function fundBondInstruction({
  program,
  configAccount,
  validatorVoteAccount,
  bondAccount,
  authority = walletPubkey(program),
  stakeAccount,
}: {
  program: ValidatorBondsProgram
  configAccount?: PublicKey
  validatorVoteAccount?: PublicKey
  bondAccount?: PublicKey
  authority?: PublicKey | Keypair | Signer // signer
  stakeAccount: PublicKey
}): Promise<{
  instruction: TransactionInstruction
}> {
  bondAccount = checkAndGetBondAddress(
    bondAccount,
    configAccount,
    validatorVoteAccount,
    program.programId
  )
  if (configAccount === undefined) {
    const bondData = await getBond(program, bondAccount)
    configAccount = bondData.config
  }
  authority = authority instanceof PublicKey ? authority : authority.publicKey

  const instruction = await program.methods
    .fundBond()
    .accounts({
      config: configAccount,
      bond: bondAccount,
      stakeAuthority: authority,
      stakeAccount,
      stakeHistory: SYSVAR_STAKE_HISTORY_PUBKEY,
      stakeProgram: StakeProgram.programId,
    })
    .instruction()
  return {
    instruction,
  }
}
