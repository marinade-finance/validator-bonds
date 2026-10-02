import { logWarn } from '@marinade.finance/ts-common'
import {
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_STAKE_HISTORY_PUBKEY,
} from '@solana/web3.js'

import { getBond } from '../api'
import { MARINADE_CONFIG_ADDRESS, bondsWithdrawerAuthority } from '../sdk'
import { checkAndGetBondAddress } from '../utils'

import type { ValidatorBondsProgram } from '../sdk'
import type { LoggerPlaceholder } from '@marinade.finance/ts-common'
import type { PublicKey, TransactionInstruction } from '@solana/web3.js'

/**
 * Generate instruction to refund the bond account balance mistakenly
 * transferred to the bond address. Lamports above the rent-exempt minimum
 * are moved onto an existing bond-funded stake account.
 * Permission-less operation, no signature required.
 */
export async function refundBondBalanceInstruction({
  program,
  bondAccount,
  stakeAccount,
  configAccount,
  voteAccount,
  logger,
}: {
  program: ValidatorBondsProgram
  bondAccount?: PublicKey
  stakeAccount: PublicKey
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
      'refundBondBalance SDK: config is not provided, using default address: ' +
        MARINADE_CONFIG_ADDRESS.toBase58(),
    )
    configAccount = MARINADE_CONFIG_ADDRESS
  }
  bondAccount = checkAndGetBondAddress({
    bond: bondAccount,
    config: configAccount,
    voteAccount,
    programId: program.programId,
  })
  if (configAccount === undefined) {
    const bondData = await getBond(program, bondAccount)
    configAccount = bondData.config
  }

  const instruction = await program.methods
    .refundBondBalance()
    .accountsPartial({
      config: configAccount,
      bond: bondAccount,
      bondsWithdrawerAuthority: bondsWithdrawerAuthority(
        configAccount,
        program.programId,
      )[0],
      stakeAccount,
      clock: SYSVAR_CLOCK_PUBKEY,
      stakeHistory: SYSVAR_STAKE_HISTORY_PUBKEY,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction()
  return {
    instruction,
    bondAccount,
  }
}
