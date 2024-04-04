import {
  PublicKey,
  TransactionInstruction,
  StakeProgram,
  SYSVAR_STAKE_HISTORY_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
  Keypair,
  Signer,
} from '@solana/web3.js'
import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import { anchorProgramWalletPubkey } from '../utils'
import {
  CloseSettlementParams,
  getCloseSettlementAccounts,
} from './closeSettlement'

/**
 * Generate instruction to cancel settlement.
 * Operation can be called anytime.
 * It is permission-ed operation for operator and emergency pause authorities.
 */
export async function cancelSettlementInstruction(
  params: CloseSettlementParams & {
    authority?: PublicKey | Keypair | Signer | WalletInterface // signer
  }
): Promise<{
  instruction: TransactionInstruction
}> {
  params.authority =
    params.authority || anchorProgramWalletPubkey(params.program)
  const authorityPubkey =
    params.authority instanceof PublicKey
      ? params.authority
      : params.authority.publicKey

  const {
    configAccount,
    bondAccount,
    settlementAccount,
    rentCollector,
    bondsAuth,
    splitRentCollector,
    splitRentRefundAccount,
  } = await getCloseSettlementAccounts(params)

  const instruction = await params.program.methods
    .cancelSettlement()
    .accounts({
      authority: authorityPubkey,
      config: configAccount,
      bond: bondAccount,
      settlement: settlementAccount,
      rentCollector,
      splitRentCollector,
      bondsWithdrawerAuthority: bondsAuth,
      splitRentRefundAccount,
      stakeProgram: StakeProgram.programId,
      stakeHistory: SYSVAR_STAKE_HISTORY_PUBKEY,
      clock: SYSVAR_CLOCK_PUBKEY,
    })
    .instruction()
  return {
    instruction,
  }
}
