import {
  PublicKey,
  StakeProgram,
  STAKE_CONFIG_ID,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_STAKE_HISTORY_PUBKEY,
  SystemProgram,
} from '@solana/web3.js'

import { getBond, getSettlement } from '../api'
import { bondsWithdrawerAuthority, settlementStakerAuthority } from '../sdk'
import { anchorProgramWalletPubkey } from '../utils'

import type { ValidatorBondsProgram } from '../sdk'
import type { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import type { TransactionInstruction, Signer, Keypair } from '@solana/web3.js'

/**
 * Generate instruction to atomically swap a settlement's delegated stake account
 * for a freshly created one of equal value that is immediately claimable. The
 * caller provides liquid SOL; the instruction creates the replacement stake
 * (createWithSeed, base == caller), delegates it to the settlement's validator
 * and instantly deactivates it (claimable now, reaps to the validator's bond at
 * close); the caller receives the settlement's original delegated stake.
 * Permission-less: only the caller signs.
 */
export async function swapSettlementStakeInstruction({
  program,
  settlementAccount,
  settlementStake,
  caller = anchorProgramWalletPubkey(program),
  newStakeAccountSeed = 'swap-settlement-stake',
  configAccount,
  bondAccount,
  voteAccount,
}: {
  program: ValidatorBondsProgram
  settlementAccount: PublicKey
  settlementStake: PublicKey
  caller?: PublicKey | Keypair | Signer | WalletInterface // signer; base, funder and new authority
  newStakeAccountSeed?: string
  configAccount?: PublicKey
  bondAccount?: PublicKey
  voteAccount?: PublicKey
}): Promise<{
  instruction: TransactionInstruction
  newStakeAccount: PublicKey
  newStakeAccountSeed: string
}> {
  if (bondAccount === undefined) {
    const settlementData = await getSettlement(program, settlementAccount)
    bondAccount = settlementData.bond
  }
  if (configAccount === undefined || voteAccount === undefined) {
    const bondData = await getBond(program, bondAccount)
    configAccount = configAccount ?? bondData.config
    voteAccount = voteAccount ?? bondData.voteAccount
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
      voteAccount,
      settlement: settlementAccount,
      settlementStakerAuthority: settlementStakerAuthority(
        settlementAccount,
        program.programId,
      )[0],
      bondsWithdrawerAuthority: bondsWithdrawerAuthority(
        configAccount,
        program.programId,
      )[0],
      settlementStake,
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
