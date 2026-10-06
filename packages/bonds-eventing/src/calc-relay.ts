import type {
  AuctionValidator,
  DsSamConfig,
} from '@marinade.finance/ds-sam-sdk'

// Auction-wide context (one value per epoch, not per validator) the CLI needs to
// reconstruct the AuctionResult for ds-sam-calc without re-running the auction.
// Extends the full DsSamConfig so new SDK config fields are carried through
// automatically instead of requiring a matching edit here.
export interface AuctionMeta extends DsSamConfig {
  epoch: number
  winningTotalPmpe: number
  marinadeSamTvlSol: number
  blacklist: string[]
}

// Coerce NaN/±Infinity (SDK leaves these on ineligible validators) to null: slonik
// sql.jsonb throws on non-finite, and calc reads them back through its own finite() guards.
export function jsonSafe<T>(value: T): T {
  if (typeof value === 'number') {
    return (Number.isFinite(value) ? value : null) as T
  }
  if (Array.isArray(value)) {
    return value.map(jsonSafe) as T
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      out[key] = jsonSafe(val)
    }
    return out as T
  }
  return value
}

// Calc-relevant subset of AuctionValidator that ds-sam-calc reads. lastCapConstraint.validators
// is dropped — it back-references the whole validator set (recursion / payload blowup).
export function toCalcValidator(v: AuctionValidator): Record<string, unknown> {
  const cap = v.lastCapConstraint
  return jsonSafe({
    voteAccount: v.voteAccount,
    bondBalanceSol: v.bondBalanceSol,
    claimableBondBalanceSol: v.claimableBondBalanceSol,
    marinadeActivatedStakeSol: v.marinadeActivatedStakeSol,
    unprotectedStakeSol: v.unprotectedStakeSol,
    maxStakeWanted: v.maxStakeWanted,
    samEligible: v.samEligible,
    samBlocked: v.samBlocked,
    minBondPmpe: v.minBondPmpe,
    idealBondPmpe: v.idealBondPmpe,
    minUnprotectedReserve: v.minUnprotectedReserve,
    idealUnprotectedReserve: v.idealUnprotectedReserve,
    bondGoodForNEpochs: v.bondGoodForNEpochs,
    unstakePriority: v.unstakePriority,
    maxBondDelegation: v.maxBondDelegation,
    bondSamStakeCapSol: v.bondSamStakeCapSol,
    auctionStake: { marinadeSamTargetSol: v.auctionStake.marinadeSamTargetSol },
    bondForcedUndelegation: { value: v.bondForcedUndelegation.value },
    revShare: { ...v.revShare },
    values: {
      bondRiskFeeSol: v.values.bondRiskFeeSol,
      paidUndelegationSol: v.values.paidUndelegationSol,
    },
    lastCapConstraint: cap
      ? {
          constraintType: cap.constraintType,
          constraintName: cap.constraintName,
          totalStakeSol: cap.totalStakeSol,
          totalLeftToCapSol: cap.totalLeftToCapSol,
          marinadeStakeSol: cap.marinadeStakeSol,
          marinadeLeftToCapSol: cap.marinadeLeftToCapSol,
        }
      : null,
    auctions: v.auctions.map(a => ({
      bidPmpe: a.bidPmpe,
      effParticipatingBidPmpe: a.effParticipatingBidPmpe,
    })),
  })
}
