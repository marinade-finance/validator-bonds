import { logDebug } from '@marinade.finance/ts-common'
import { getConnection } from '@marinade.finance/web3js-1x'
import { VOTE_PROGRAM_ID } from '@solana/web3.js'

import type { LoggerPlaceholder } from '@marinade.finance/ts-common'
import type {
  HasProvider,
  Provider,
  ProgramAccountInfo,
} from '@marinade.finance/web3js-1x'
import type {
  Connection,
  GetProgramAccountsFilter,
  PublicKey,
} from '@solana/web3.js'

// Depending if new vote account feature-set is gated on.
// It can be 3762 or 3736
// https://github.com/solana-labs/solana-web3.js/blob/v1.87.6/packages/library-legacy/src/programs/vote.ts#L372
// It may emit error:
//  Failed to process transaction: transport transaction error: Error processing Instruction 1: invalid account data for instruction
export const VOTE_ACCOUNT_SIZE = 3762
// https://github.com/solana-labs/solana/blob/v1.17.10/sdk/program/src/vote/state/vote_state_versions.rs#L4
const VALIDATOR_IDENTITY_OFFSET = 4

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

export async function findVoteAccountByIdentity({
  connection,
  identity,
  logger,
}: {
  connection: Provider | Connection | HasProvider
  identity: PublicKey
  logger?: LoggerPlaceholder
}): Promise<ProgramAccountInfo<Buffer> | undefined> {
  const filters: GetProgramAccountsFilter[] = [
    {
      memcmp: {
        offset: VALIDATOR_IDENTITY_OFFSET,
        bytes: identity.toBase58(),
      },
    },
  ]

  connection = getConnection(connection)
  const accounts = await connection.getProgramAccounts(VOTE_PROGRAM_ID, {
    filters,
  })

  if (
    accounts.length === 0 ||
    accounts.length > 1 ||
    accounts[0] === undefined
  ) {
    logDebug(
      logger,
      `Found ${accounts.length} (${accounts.map(a => a.pubkey.toBase58()).join(', ')}) vote accounts for identity ${identity.toBase58()}.` +
        'Expectation was to have potentially find one vote account for the identity.',
    )
    return undefined
  }

  const voteAccountData = accounts[0]
  return {
    publicKey: voteAccountData.pubkey,
    account: voteAccountData.account,
  }
}
