import { Provider } from '@marinade.finance/web3js-common'

// Depending if new vote account feature-set is gated on.
// It can be 3762 or 3736
// https://github.com/solana-labs/solana-web3.js/blob/v1.87.6/packages/library-legacy/src/programs/vote.ts#L372
// It may emit error:
//  Failed to process transaction: transport transaction error: Error processing Instruction 1: invalid account data for instruction
export const VOTE_ACCOUNT_SIZE = 3762

export async function getRentExemptVote(
  provider: Provider,
  rentExempt?: number,
): Promise<number> {
  return (
    rentExempt ??
    (await provider.connection.getMinimumBalanceForRentExemption(
      VOTE_ACCOUNT_SIZE,
    ))
  )
}
