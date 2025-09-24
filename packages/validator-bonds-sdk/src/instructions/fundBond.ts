import { logWarn } from '@marinade.finance/ts-common'
import {
  PublicKey,
  SYSVAR_STAKE_HISTORY_PUBKEY,
  StakeProgram,
} from '@solana/web3.js'

import { getBond } from '../api'
import { MARINADE_CONFIG_ADDRESS } from '../sdk'
import { checkAndGetBondAddress, anchorProgramWalletPubkey } from '../utils'

import type { ValidatorBondsProgram } from '../sdk'
import type { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import type { LoggerPlaceholder } from '@marinade.finance/ts-common'
import type { Keypair, Signer, TransactionInstruction } from '@solana/web3.js'

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
  logger,
}: {
  program: ValidatorBondsProgram
  bondAccount?: PublicKey
  stakeAccount: PublicKey
  stakeAccountAuthority?: PublicKey | Keypair | Signer | WalletInterface // signer
  configAccount?: PublicKey
  voteAccount?: PublicKey
  logger?: LoggerPlaceholder
}): Promise<{
  instruction: TransactionInstruction
  bondAccount: PublicKey
}> {
  if (!bondAccount && !configAccount && voteAccount) {
    logWarn(
      logger,
      'fundBond SDK: config is not provided, using default address: ' +
        MARINADE_CONFIG_ADDRESS.toBase58()
    )
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
