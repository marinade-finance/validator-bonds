import {
  PublicKey,
  TransactionInstruction,
  StakeProgram,
  SYSVAR_STAKE_HISTORY_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
  Keypair,
  Signer,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
} from '@solana/web3.js'
import { ValidatorBondsProgram, bondAddress } from '../sdk'
import { getBond, getConfig, getSettlement } from '../api'
import { anchorProgramWalletPubkey } from '../utils'
import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'

/**
 * Generate instruction to fund settlement protected event.
 * Only operator authority is permitted to do this.
 * Depositing the funded bond stake accounts to the settlement account.
 * The stake account lamports covers the protected event
 * and funds can be claimed from the accounts later.
 */
export async function fundSettlementInstruction({
  program,
  settlementAccount,
  stakeAccount,
  configAccount,
  bondAccount,
  voteAccount,
  operatorAuthority,
  splitStakeAccount = Keypair.generate(),
  splitStakeRentPayer = anchorProgramWalletPubkey(program),
}: {
  program: ValidatorBondsProgram
  settlementAccount: PublicKey
  stakeAccount: PublicKey
  configAccount?: PublicKey
  bondAccount?: PublicKey
  voteAccount?: PublicKey
  operatorAuthority?: PublicKey | Keypair | Signer | WalletInterface // signer
  splitStakeAccount?: PublicKey | Keypair | Signer | WalletInterface // signer
  splitStakeRentPayer?: PublicKey | Keypair | Signer | WalletInterface // signer
}): Promise<{
  instruction: TransactionInstruction
  splitStakeAccount: PublicKey | Keypair | Signer | WalletInterface
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

  if (configAccount === undefined) {
    const bondData = await getBond(program, bondAccount)
    configAccount = bondData.config
  }

  if (operatorAuthority === undefined) {
    const configData = await getConfig(program, configAccount)
    operatorAuthority = configData.operatorAuthority
  }
  const operatorAuthorityPubkey =
    operatorAuthority instanceof PublicKey
      ? operatorAuthority
      : operatorAuthority.publicKey

  const splitStakeAccountPubkey =
    splitStakeAccount instanceof PublicKey
      ? splitStakeAccount
      : splitStakeAccount.publicKey
  const splitStakeRentPayerPubkey =
    splitStakeRentPayer instanceof PublicKey
      ? splitStakeRentPayer
      : splitStakeRentPayer.publicKey

  const instruction = await program.methods
    .fundSettlement()
    .accounts({
      config: configAccount,
      bond: bondAccount,
      settlement: settlementAccount,
      operatorAuthority: operatorAuthorityPubkey,
      stakeAccount,
      splitStakeAccount: splitStakeAccountPubkey,
      splitStakeRentPayer: splitStakeRentPayerPubkey,
      systemProgram: SystemProgram.programId,
      stakeHistory: SYSVAR_STAKE_HISTORY_PUBKEY,
      rent: SYSVAR_RENT_PUBKEY,
      clock: SYSVAR_CLOCK_PUBKEY,
      stakeProgram: StakeProgram.programId,
    })
    .instruction()
  return {
    instruction,
    splitStakeAccount,
  }
}
