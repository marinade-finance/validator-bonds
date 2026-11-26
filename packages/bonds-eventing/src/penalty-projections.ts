import {
  calcBondRiskFee,
  computeBondCoverage,
  type AuctionValidator,
} from '@marinade.finance/ds-sam-sdk'
import { pmpeToSol } from '@marinade.finance/ts-common'

import {
  DUST_SOL_THRESHOLD,
  finiteOr,
  fmtSol,
  isAuctionPublished,
} from './evaluate-deltas'

import type { AuctionMeta } from './calc-relay'
import type { PenaltyProjectedDetails, PenaltyType } from './types'

export interface ProjectedPenalty {
  penaltyType: PenaltyType
  projectedSol: number
  message: string
  details: PenaltyProjectedDetails
}

function projectBondRiskFee(
  v: AuctionValidator,
  meta: AuctionMeta,
  forEpoch: number,
): ProjectedPenalty | null {
  if (v.claimableBondBalanceSol == null) return null
  const stakeSol = finiteOr(v.marinadeActivatedStakeSol, 0)
  // The epoch-N bid settlement is debited at the start of N+1, before the N+1 auction snapshot.
  const pendingDrainSol = pmpeToSol(
    finiteOr(v.auctions[0]?.effParticipatingBidPmpe, 0),
    stakeSol,
  ).toNumber()
  const claimableSol = Math.max(0, v.claimableBondBalanceSol - pendingDrainSol)
  const bondBalanceSol = Math.max(
    0,
    finiteOr(v.bondBalanceSol, 0) - pendingDrainSol,
  )
  if (bondBalanceSol <= meta.noBondBalanceSol) return null
  // The live run already added this auction's own undelegation; the next one starts from the carried part.
  const carriedUndelegationSol = computeBondCoverage(
    v,
    meta,
    meta.winningTotalPmpe,
  ).carriedPaidUndelegationSol
  const clone: AuctionValidator = {
    ...v,
    bondBalanceSol,
    claimableBondBalanceSol: claimableSol,
    values: { ...v.values, paidUndelegationSol: carriedUndelegationSol },
    revShare: { ...v.revShare },
  }
  const fee = calcBondRiskFee(meta, clone)
  if (fee === null || fee.bondRiskFeeSol <= DUST_SOL_THRESHOLD) return null
  const exposedSol = Math.max(
    0,
    stakeSol - carriedUndelegationSol - finiteOr(v.unprotectedStakeSol, 0),
  )
  const topUpSol = Math.max(
    0,
    finiteOr(v.minUnprotectedReserve, 0) +
      pmpeToSol(finiteOr(v.minBondPmpe, 0), exposedSol).toNumber() -
      claimableSol,
  )
  return {
    penaltyType: 'bond_risk_fee',
    projectedSol: fee.bondRiskFeeSol,
    message:
      `Validator ${v.voteAccount} is projected to pay a bond risk fee of ~${fmtSol(fee.bondRiskFeeSol)} SOL ` +
      `at the epoch ${forEpoch} auction, once the ~${fmtSol(pendingDrainSol)} SOL bid settlement ` +
      `is debited. Top up ~${fmtSol(topUpSol)} SOL to avoid it.`,
    details: {
      penalty_type: 'bond_risk_fee',
      for_epoch: forEpoch,
      projected_sol: fee.bondRiskFeeSol,
      stake_sol: stakeSol,
      bond_balance_sol: v.bondBalanceSol ?? null,
      claimable_bond_balance_sol: v.claimableBondBalanceSol,
      pending_drain_sol: pendingDrainSol,
      top_up_sol: topUpSol,
    },
  }
}

function projectPmpePenalty(
  v: AuctionValidator,
  penaltyType: 'bid_too_low' | 'blacklist',
  forEpoch: number,
): ProjectedPenalty | null {
  const stakeSol = finiteOr(v.marinadeActivatedStakeSol, 0)
  const penaltyPmpe = finiteOr(
    penaltyType === 'bid_too_low'
      ? v.revShare.bidTooLowPenaltyPmpe
      : v.revShare.blacklistPenaltyPmpe,
    0,
  )
  const projectedSol = pmpeToSol(penaltyPmpe, stakeSol).toNumber()
  if (projectedSol <= DUST_SOL_THRESHOLD) return null
  const amount = `~${fmtSol(projectedSol)} SOL`
  if (penaltyType === 'blacklist') {
    return {
      penaltyType,
      projectedSol,
      message:
        `Validator ${v.voteAccount} is blacklisted and projected to pay a blacklist penalty ` +
        `of ${amount} at the epoch ${forEpoch} auction.`,
      details: {
        penalty_type: penaltyType,
        for_epoch: forEpoch,
        projected_sol: projectedSol,
        stake_sol: stakeSol,
        penalty_pmpe: penaltyPmpe,
      },
    }
  }
  const restoreBidPmpe = v.auctions[0]?.bidPmpe ?? null
  return {
    penaltyType,
    projectedSol,
    message:
      `Validator ${v.voteAccount} lowered its bid and is projected to pay a bid-too-low penalty ` +
      `of ${amount} at the epoch ${forEpoch} auction.` +
      (restoreBidPmpe !== null
        ? ` Raise the bid back to ${restoreBidPmpe} PMPE to avoid it.`
        : ''),
    details: {
      penalty_type: penaltyType,
      for_epoch: forEpoch,
      projected_sol: projectedSol,
      stake_sol: stakeSol,
      penalty_pmpe: penaltyPmpe,
      bid_pmpe: v.revShare.bidPmpe,
      restore_bid_pmpe: restoreBidPmpe,
    },
  }
}

/**
 * Projects the SAM penalties the next auction would charge. Returns null while the
 * auction of `epoch` is unpublished: the live run is then that auction itself.
 */
export function projectSamPenalties(
  v: AuctionValidator,
  epoch: number,
  meta: AuctionMeta,
): ProjectedPenalty[] | null {
  if (!isAuctionPublished(v, epoch)) return null
  const forEpoch = epoch + 1
  return [
    projectBondRiskFee(v, meta, forEpoch),
    projectPmpePenalty(v, 'bid_too_low', forEpoch),
    projectPmpePenalty(v, 'blacklist', forEpoch),
  ].filter((p): p is ProjectedPenalty => p !== null)
}
