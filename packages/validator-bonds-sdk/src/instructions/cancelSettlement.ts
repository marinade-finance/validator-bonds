import { PublicKey } from '@solana/web3.js'

import { anchorProgramWalletPubkey } from '../utils'
import { getCloseSettlementAccounts } from './closeSettlementV2'

import type { CloseSettlementParams } from './closeSettlementV2'
import type { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import type { TransactionInstruction, Keypair, Signer } from '@solana/web3.js'

/**
 * Generate instruction to cancel settlement.
 * Operation can be called anytime.
 * It is permission-ed operation for operator and emergency pause authorities.
 */
export async function cancelSettlementInstruction(
  params: CloseSettlementParams & {
    authority?: PublicKey | Keypair | Signer | WalletInterface // signer
  },
): Promise<{
  instruction: TransactionInstruction
}> {
  params.authority =
    params.authority || anchorProgramWalletPubkey(params.program)
  const authorityPubkey =
    params.authority instanceof PublicKey
      ? params.authority
      : params.authority.publicKey

  const { splitRentCollector, splitRentRefundAccount } =
    await getCloseSettlementAccounts(params)

  const instruction = await params.program.methods
    .cancelSettlement()
    .accounts({
      program: params.program.programId,
      authority: authorityPubkey,
      splitRentCollector,
      splitRentRefundAccount,
    })
    .instruction()
  return {
    instruction,
  }
}
