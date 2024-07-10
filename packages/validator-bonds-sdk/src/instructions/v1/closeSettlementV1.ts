import {
  TransactionInstruction,
  StakeProgram,
  SYSVAR_STAKE_HISTORY_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
} from '@solana/web3.js'
import {
  CloseSettlementParams,
  getCloseSettlementAccounts,
} from '../closeSettlementV2'

/**
 * Generate instruction to close settlement V1,
 * when SettlementClaim was a separate PDA account to be closed later.
 */
export async function closeSettlementV1Instruction(
  params: CloseSettlementParams
): Promise<{
  instruction: TransactionInstruction
}> {
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
    .closeSettlement()
    .accounts({
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
