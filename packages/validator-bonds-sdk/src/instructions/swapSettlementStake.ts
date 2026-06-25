import { PublicKey, StakeProgram, SYSVAR_CLOCK_PUBKEY } from '@solana/web3.js'

import { getBond, getSettlement } from '../api'
import { bondsWithdrawerAuthority, settlementStakerAuthority } from '../sdk'

import type { ValidatorBondsProgram } from '../sdk'
import type { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import type { TransactionInstruction, Signer, Keypair } from '@solana/web3.js'

/**
 * Generate instruction to atomically swap a settlement's delegated stake account
 * for a user-provided undelegated (ready-to-claim) one of equal value.
 * The user receives the settlement's delegated stake; the settlement receives the
 * user's undelegated stake, which is immediately claimable. Permissionless.
 */
export async function swapSettlementStakeInstruction({
  program,
  settlementAccount,
  settlementStake,
  userStake,
  userAuthority,
  configAccount,
  bondAccount,
}: {
  program: ValidatorBondsProgram
  settlementAccount: PublicKey
  settlementStake: PublicKey
  userStake: PublicKey
  userAuthority: PublicKey | Keypair | Signer | WalletInterface // signer
  configAccount?: PublicKey
  bondAccount?: PublicKey
}): Promise<{
  instruction: TransactionInstruction
}> {
  if (bondAccount === undefined) {
    const settlementData = await getSettlement(program, settlementAccount)
    bondAccount = settlementData.bond
  }
  if (configAccount === undefined) {
    const bondData = await getBond(program, bondAccount)
    configAccount = bondData.config
  }

  const userAuthorityPubkey =
    userAuthority instanceof PublicKey ? userAuthority : userAuthority.publicKey

  const instruction = await program.methods
    .swapSettlementStake()
    .accountsPartial({
      config: configAccount,
      bond: bondAccount,
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
      clock: SYSVAR_CLOCK_PUBKEY,
      stakeProgram: StakeProgram.programId,
    })
    .instruction()
  return {
    instruction,
  }
}
