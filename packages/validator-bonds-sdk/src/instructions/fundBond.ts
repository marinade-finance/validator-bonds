import {
  Keypair,
  PublicKey,
  SYSVAR_STAKE_HISTORY_PUBKEY,
  Signer,
  StakeProgram,
  TransactionInstruction,
} from '@solana/web3.js'
import { MARINADE_CONFIG_ADDRESS, ValidatorBondsProgram } from '../sdk'
import { checkAndGetBondAddress, anchorProgramWalletPubkey } from '../utils'
import { getBond } from '../api'
import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'

/**
 * Generate instruction to fund bond with a stake account.
 * Permission-less operation, signature of stake account owner is required.
 * The amount in lamports is the deposit that protects staking of the validator
 * linked through the vote account defined in bond account.
 */
export async function fundBondInstruction({
  program,
  bondAccount,
  stakeAccount,
  stakeAccountAuthority = anchorProgramWalletPubkey(program),
  configAccount,
  voteAccount,
}: {
  program: ValidatorBondsProgram
  bondAccount?: PublicKey
  stakeAccount: PublicKey
  stakeAccountAuthority?: PublicKey | Keypair | Signer | WalletInterface // signer
  configAccount?: PublicKey
  voteAccount?: PublicKey
}): Promise<{
  instruction: TransactionInstruction
  bondAccount: PublicKey
}> {
  if (!bondAccount && !configAccount && voteAccount) {
    configAccount = MARINADE_CONFIG_ADDRESS
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
  stakeAccountAuthority =
    stakeAccountAuthority instanceof PublicKey
      ? stakeAccountAuthority
      : stakeAccountAuthority.publicKey

  const instruction = await program.methods
    .fundBond()
    .accounts({
      config: configAccount,
      bond: bondAccount,
      stakeAuthority: stakeAccountAuthority,
      stakeAccount,
      stakeHistory: SYSVAR_STAKE_HISTORY_PUBKEY,
      stakeProgram: StakeProgram.programId,
    })
    .instruction()
  return {
    instruction,
    bondAccount,
  }
}
