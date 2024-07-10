import { PublicKey, TransactionInstruction } from '@solana/web3.js'
import { ValidatorBondsProgram, bondsWithdrawerAuthority } from '../../sdk'
import { getSettlementClaim, settlementClaimAddress } from './settlementClaimV1'

/**
 * Generate instruction to close settlement claim V1.
 * The new version of processing does not use PDA for deduplication of claiming
 * but it uses Bitmap saved in 'SettlementClaims' account.
 */
export async function closeSettlementClaimV1Instruction({
  program,
  settlementAccount,
  settlementClaimAccount,
  rentCollector,
  configAccount,
  withdrawer,
  claimAmount,
}: {
  program: ValidatorBondsProgram
  settlementAccount: PublicKey
  settlementClaimAccount?: PublicKey
  rentCollector?: PublicKey
  configAccount?: PublicKey
  voteAccount?: PublicKey
  withdrawer?: PublicKey
  claimAmount?: number
}): Promise<{
  instruction: TransactionInstruction
}> {
  if (
    settlementClaimAccount === undefined &&
    configAccount &&
    withdrawer &&
    claimAmount
  ) {
    const [bondsWithdrawerAuth] = bondsWithdrawerAuthority(
      configAccount,
      program.programId
    )
    settlementClaimAccount = settlementClaimAddress(
      {
        settlement: settlementAccount,
        stakeAccountStaker: bondsWithdrawerAuth,
        stakeAccountWithdrawer: withdrawer,
        claim: claimAmount,
      },
      program.programId
    )[0]
  }

  if (!settlementClaimAccount) {
    throw new Error(
      'settlementClaimAccount is required, provide address or parameters to derive it'
    )
  }

  if (!rentCollector) {
    const settlementClaimData = await getSettlementClaim(
      program,
      settlementClaimAccount
    )
    rentCollector = settlementClaimData.rentCollector
  }

  const instruction = await program.methods
    .closeSettlementClaim()
    .accounts({
      settlement: settlementAccount,
      settlementClaim: settlementClaimAccount,
      rentCollector,
    })
    .instruction()
  return {
    instruction,
  }
}
