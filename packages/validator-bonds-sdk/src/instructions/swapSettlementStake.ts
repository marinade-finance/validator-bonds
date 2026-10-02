import {
  PublicKey,
  StakeProgram,
  STAKE_CONFIG_ID,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_STAKE_HISTORY_PUBKEY,
} from '@solana/web3.js'

import { getBond, getConfig, getSettlement } from '../api'
import { bondsWithdrawerAuthority, settlementStakerAuthority } from '../sdk'

import type { ValidatorBondsProgram } from '../sdk'
import type { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import type { TransactionInstruction, Signer, Keypair } from '@solana/web3.js'

/**
 * Generate instruction to atomically swap a settlement's delegated stake account
 * for a user-provided undelegated one of equal value. The user's stake is
 * delegated to the settlement's validator and instantly deactivated (claimable
 * now, reaps to the validator's bond at close); the user receives the
 * settlement's delegated stake. Permissioned to the operator authority (AML/KYC).
 */
export async function swapSettlementStakeInstruction({
  program,
  settlementAccount,
  settlementStake,
  userStake,
  userAuthority,
  operatorAuthority,
  configAccount,
  bondAccount,
  voteAccount,
}: {
  program: ValidatorBondsProgram
  settlementAccount: PublicKey
  settlementStake: PublicKey
  userStake: PublicKey
  userAuthority: PublicKey | Keypair | Signer | WalletInterface // signer
  operatorAuthority?: PublicKey | Keypair | Signer | WalletInterface // signer
  configAccount?: PublicKey
  bondAccount?: PublicKey
  voteAccount?: PublicKey
}): Promise<{
  instruction: TransactionInstruction
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
  if (operatorAuthority === undefined) {
    const configData = await getConfig(program, configAccount)
    operatorAuthority = configData.operatorAuthority
  }

  const userAuthorityPubkey =
    userAuthority instanceof PublicKey ? userAuthority : userAuthority.publicKey
  const operatorAuthorityPubkey =
    operatorAuthority instanceof PublicKey
      ? operatorAuthority
      : operatorAuthority.publicKey

  const instruction = await program.methods
    .swapSettlementStake()
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
      userStake,
      userAuthority: userAuthorityPubkey,
      operatorAuthority: operatorAuthorityPubkey,
      stakeHistory: SYSVAR_STAKE_HISTORY_PUBKEY,
      clock: SYSVAR_CLOCK_PUBKEY,
      stakeProgram: StakeProgram.programId,
      stakeConfig: STAKE_CONFIG_ID,
    })
    .instruction()
  return {
    instruction,
  }
}
