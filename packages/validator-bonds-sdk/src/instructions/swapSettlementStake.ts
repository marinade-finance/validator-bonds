import {
  PublicKey,
  StakeProgram,
  SYSVAR_STAKE_HISTORY_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  STAKE_CONFIG_ID,
  SystemProgram,
} from '@solana/web3.js'

import { getBond, getSettlement } from '../api'
import {
  bondAddress,
  bondsWithdrawerAuthority,
  settlementStakerAuthority,
} from '../sdk'
import { anchorProgramWalletPubkey } from '../utils'

import type { ValidatorBondsProgram } from '../sdk'
import type { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import type { TransactionInstruction, Signer, Keypair } from '@solana/web3.js'

/**
 * Generate instruction to swap an active settlement-funded stake account for an
 * immediately inactive one, so claiming can start without waiting for deactivation.
 * Permission-less: the caller funds the replacement stake account from their own SOL
 * and receives the original active stake account in exchange.
 * The replacement stake account is derived from (caller, seed) via createWithSeed,
 * so no throw-away keypair is needed; the program creates it within the instruction.
 */
export async function swapSettlementStakeInstruction({
  program,
  settlementAccount,
  stakeAccount,
  configAccount,
  bondAccount,
  voteAccount,
  caller = anchorProgramWalletPubkey(program),
  newStakeAccountSeed = 'swap-settlement-stake',
}: {
  program: ValidatorBondsProgram
  settlementAccount: PublicKey
  stakeAccount: PublicKey
  configAccount?: PublicKey
  bondAccount?: PublicKey
  voteAccount?: PublicKey
  caller?: PublicKey | Keypair | Signer | WalletInterface // signer; base, funder and new authority
  newStakeAccountSeed?: string
}): Promise<{
  instruction: TransactionInstruction
  newStakeAccount: PublicKey
  newStakeAccountSeed: string
}> {
  if (
    voteAccount !== undefined &&
    configAccount !== undefined &&
    bondAccount === undefined
  ) {
    ;[bondAccount] = bondAddress(configAccount, voteAccount, program.programId)
  }
  if (bondAccount === undefined) {
    const settlementData = await getSettlement(program, settlementAccount)
    bondAccount = settlementData.bond
  }

  if (configAccount === undefined || voteAccount === undefined) {
    const bondData = await getBond(program, bondAccount)
    configAccount = bondData.config
    voteAccount = bondData.voteAccount
  }

  const callerPubkey = caller instanceof PublicKey ? caller : caller.publicKey

  // must match the program's create_account_with_seed(base == caller)
  const newStakeAccount = await PublicKey.createWithSeed(
    callerPubkey,
    newStakeAccountSeed,
    StakeProgram.programId,
  )

  const instruction = await program.methods
    .swapSettlementStake({
      stakeAccountSeed: newStakeAccountSeed,
    })
    .accountsPartial({
      config: configAccount,
      bond: bondAccount,
      voteAccount: voteAccount,
      settlement: settlementAccount,
      settlementStakerAuthority: settlementStakerAuthority(
        settlementAccount,
        program.programId,
      )[0],
      bondsWithdrawerAuthority: bondsWithdrawerAuthority(
        configAccount,
        program.programId,
      )[0],
      stakeAccount,
      newStakeAccount,
      caller: callerPubkey,
      systemProgram: SystemProgram.programId,
      stakeHistory: SYSVAR_STAKE_HISTORY_PUBKEY,
      clock: SYSVAR_CLOCK_PUBKEY,
      rent: SYSVAR_RENT_PUBKEY,
      stakeProgram: StakeProgram.programId,
      stakeConfig: STAKE_CONFIG_ID,
    })
    .instruction()

  return {
    instruction,
    newStakeAccount,
    newStakeAccountSeed,
  }
}
