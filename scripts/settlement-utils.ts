// Shared settlement-JSON types and helpers for off-chain distribution scripts.
// TODO: move to @marinade.finance/ds-sam once that package exists.

export type Reason =
  | 'Bidding'
  | 'PriorityFee'
  | 'BidTooLowPenalty'
  | 'BlacklistPenalty'
  | 'BondRiskFee'
  | 'InstitutionalPayout'
  | { ProtectedEvent: { DowntimeRevenueImpact?: Record<string, unknown> } }

export type Settlement = {
  reason: Reason
  vote_account: string
  claims_amount: number
  details: {
    marinade_fee_claim: number
    dao_fee_claim: number
    [k: string]: unknown
  } | null
}

export function isProtectedEvent(r: Reason): r is {
  ProtectedEvent: { DowntimeRevenueImpact?: Record<string, unknown> }
} {
  return typeof r === 'object'
}

/** Sum of PSR + penalty lamports redistributed to stakers (uses claims_amount). */
export function sumStakerExtras(settlements: Settlement[]): number {
  return settlements.reduce((sum, s) => {
    if (isProtectedEvent(s.reason)) return sum + s.claims_amount
    if (
      s.reason === 'BidTooLowPenalty' ||
      s.reason === 'BlacklistPenalty' ||
      s.reason === 'BondRiskFee'
    )
      return sum + s.claims_amount
    return sum
  }, 0)
}

/** Per-vote-account sum of marinade_fee_claim + dao_fee_claim across all settlements. */
export function feesByVoteAccount(
  settlements: Settlement[],
): Map<string, number> {
  const m = new Map<string, number>()
  for (const s of settlements) {
    if (!s.details) continue
    m.set(
      s.vote_account,
      (m.get(s.vote_account) ?? 0) +
        (s.details.marinade_fee_claim ?? 0) +
        (s.details.dao_fee_claim ?? 0),
    )
  }
  return m
}
