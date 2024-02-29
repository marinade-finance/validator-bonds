import { PublicKey, TransactionInstruction } from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  settlementClaimAddress,
  bondsWithdrawerAuthority,
} from '../sdk'
import { getSettlementClaim } from '../api'

/**
 * Generate instruction to close settlement claim.
 * This is a permission-less operation,
 * the settlement claim can be closed when the settlement account does not exist.
 * Purpose is to gain back rent exempt of the settlement claim account.
 */
export async function closeSettlementClaimInstruction({
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
