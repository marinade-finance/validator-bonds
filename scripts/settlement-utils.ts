// Shared settlement-JSON types and helpers for off-chain distribution scripts.
// TODO: move to @marinade.finance/ds-sam once that package exists.

type FeeDetails = { marinade_fee_claim: number; dao_fee_claim: number }

export type BidDetails = FeeDetails & {
  total_marinade_active_stake: number
  total_marinade_redelegation_stake?: number
  total_marinade_stakers_rewards: string
}

type PriorityFeeDetails = FeeDetails & {
  total_marinade_active_stake: number
  activating_bid_claim: string
}

type PenaltyDetails = Record<string, unknown>

type ProtectedEventReason = {
  ProtectedEvent: { DowntimeRevenueImpact?: Record<string, unknown> }
}

export function isProtectedEvent(
  r: Settlement['reason'],
): r is ProtectedEventReason {
  return typeof r === 'object'
}

export type Settlement =
  | {
      reason: 'Bidding'
      vote_account: string
      claims_amount: number
      details: BidDetails
    }
  | {
      reason: 'PriorityFee'
      vote_account: string
      claims_amount: number
      details: PriorityFeeDetails
    }
  | {
      reason: 'BidTooLowPenalty' | 'BlacklistPenalty' | 'BondRiskFee'
      vote_account: string
      claims_amount: number
      details: PenaltyDetails
    }
  | {
      reason: 'InstitutionalPayout'
      vote_account: string
      claims_amount: number
      details: null
    }
  | {
      reason: ProtectedEventReason
      vote_account: string
      claims_amount: number
      details: null
    }

export type BidSettlement = Extract<Settlement, { reason: 'Bidding' }>
export type FeeSettlement = Extract<
  Settlement,
  { reason: 'Bidding' | 'PriorityFee' }
>
export function isFeeSettlement(s: Settlement): s is FeeSettlement {
  return s.reason === 'Bidding' || s.reason === 'PriorityFee'
}

/** Sum of PSR + penalty lamports redistributed to stakers (uses claims_amount). */
export function sumStakerExtras(settlements: Settlement[]): number {
  return settlements.reduce((sum, s) => {
    if (
      isProtectedEvent(s.reason) ||
      s.reason === 'BidTooLowPenalty' ||
      s.reason === 'BlacklistPenalty' ||
      s.reason === 'BondRiskFee'
    )
      return sum + s.claims_amount
    return sum
  }, 0)
}

/** Per-vote-account sum of marinade_fee_claim + dao_fee_claim across Bidding and PriorityFee. */
export function feesByVoteAccount(
  settlements: Settlement[],
): Map<string, number> {
  const m = new Map<string, number>()
  for (const s of settlements) {
    if (s.reason !== 'Bidding' && s.reason !== 'PriorityFee') continue
    m.set(
      s.vote_account,
      (m.get(s.vote_account) ?? 0) +
        s.details.marinade_fee_claim +
        s.details.dao_fee_claim,
    )
  }
  return m
}
