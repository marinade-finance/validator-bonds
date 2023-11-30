import {
  Keypair,
  PublicKey,
  Signer,
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
  stakeAuthority = walletPubkey(program),
  stakeAccount,
}: {
  program: ValidatorBondsProgram
  configAccount?: PublicKey
  validatorVoteAccount?: PublicKey
  bondAccount?: PublicKey
  stakeAuthority?: PublicKey | Keypair | Signer // signer
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
  stakeAuthority =
    stakeAuthority instanceof PublicKey
      ? stakeAuthority
      : stakeAuthority.publicKey

  const instruction = await program.methods
    .fundBond()
    .accounts({
      config: configAccount,
      bond: bondAccount,
      stakeAuthority,
      stakeAccount,
    })
    .instruction()
  return {
    instruction,
  }
}
