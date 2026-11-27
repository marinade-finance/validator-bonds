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
  makeBaseEvent,
} from './evaluate-deltas'

import type { AuctionMeta } from './calc-relay'
import type {
  BondType,
  BondsEventV1,
  PenaltyProjectedDetails,
  PenaltyType,
  ProjectedPenaltiesState,
  ValidatorState,
} from './types'
import type { VatForecast } from './vat-forecast'

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
    finiteOr(v.auctions[0]?.auctionEffectiveBidPmpe, 0),
    stakeSol,
  ).toNumber()
  // The next auction gates on its lastBondBalanceSol, the balance before this drain.
  if (finiteOr(v.bondBalanceSol, 0) <= meta.noBondBalanceSol) return null
  const claimableSol = Math.max(0, v.claimableBondBalanceSol - pendingDrainSol)
  const bondBalanceSol = Math.max(
    0,
    finiteOr(v.bondBalanceSol, 0) - pendingDrainSol,
  )
  // The live run added its own undelegation; the next auction starts from the carried part.
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

const VAT_ACTIONS: Record<
  string,
  (minVoteBalanceSol: number | null) => string
> = {
  low_balance: min =>
    min === null
      ? 'Top up the vote account.'
      : `Top up the vote account to at least ${Math.ceil(min * 1e4) / 1e4} SOL.`,
  no_bls_key: () => 'Register a BLS key for the vote account.',
  no_stake: () => 'The vote account has no stake.',
  below_cutoff: () => 'The vote account stake is below the VAT cutoff.',
}

/**
 * Projects the VAT-refusal charge of the next epoch from the running-epoch verdict.
 * Returns null when the forecast is for another epoch, misses the vote account or has no verdict.
 */
export function projectVatPenalty(
  vat: VatForecast,
  voteAccount: string,
  stakeSol: number,
  bondType: BondType,
  epoch: number,
): ProjectedPenalty[] | null {
  const verdict = vat.byVoteAccount.get(voteAccount)
  if (
    vat.epoch !== epoch ||
    verdict === undefined ||
    verdict.eligible === null
  ) {
    return null
  }
  const projectedSol = pmpeToSol(vat.inflationPmpe, stakeSol).toNumber()
  if (verdict.eligible || projectedSol <= DUST_SOL_THRESHOLD) {
    return []
  }
  const forEpoch = epoch + 1
  const action =
    verdict.reason === null
      ? ''
      : ` ${VAT_ACTIONS[verdict.reason]?.(vat.minVoteBalanceSol) ?? `Reason: ${verdict.reason}.`}`
  const samExit =
    bondType === 'bidding' ? ' A refused validator also leaves SAM.' : ''
  return [
    {
      penaltyType: 'vat_unadmitted',
      projectedSol,
      message:
        `Validator ${voteAccount} fails the VAT admission check and is projected to owe ` +
        `~${fmtSol(projectedSol)} SOL of stakers' inflation from the bond if refused at the ` +
        `epoch ${forEpoch} boundary.${action}${samExit}`,
      details: {
        penalty_type: 'vat_unadmitted',
        for_epoch: forEpoch,
        projected_sol: projectedSol,
        stake_sol: stakeSol,
        vat_rejection_reason: verdict.reason,
        inflation_pmpe: vat.inflationPmpe,
      },
    },
  ]
}

export interface Projection {
  sam: ProjectedPenalty[] | null
  vat: ProjectedPenalty[] | null
}

const SAM_TYPES: PenaltyType[] = ['bond_risk_fee', 'bid_too_low', 'blacklist']
const VAT_TYPES: PenaltyType[] = ['vat_unadmitted']

function resolvedPenalty(
  penaltyType: PenaltyType,
  forEpoch: number,
  voteAccount: string,
): ProjectedPenalty {
  return {
    penaltyType,
    projectedSol: 0,
    message: `Validator ${voteAccount} is no longer projected to pay the ${penaltyType.replaceAll('_', ' ')} charge of epoch ${forEpoch}.`,
    details: {
      penalty_type: penaltyType,
      for_epoch: forEpoch,
      projected_sol: 0,
    },
  }
}

/**
 * Decides which projections to announce: a type that appears, or one that disappears
 * within the same for_epoch (resolved). A group that was not evaluated keeps its entries.
 */
export function diffProjectedPenalties(
  prev: ProjectedPenaltiesState | null | undefined,
  current: Projection,
  forEpoch: number,
  voteAccount: string,
): { emit: ProjectedPenalty[]; next: ProjectedPenaltiesState | null } {
  if (current.sam === null && current.vat === null) {
    return { emit: [], next: prev ?? null }
  }
  const previous = prev?.for_epoch === forEpoch ? prev.types : {}
  const types: ProjectedPenaltiesState['types'] = { ...previous }
  const emit: ProjectedPenalty[] = []
  for (const [group, groupTypes] of [
    [current.sam, SAM_TYPES],
    [current.vat, VAT_TYPES],
  ] as const) {
    if (group === null) continue
    for (const type of groupTypes) {
      const projection = group.find(p => p.penaltyType === type)
      if (projection) {
        if (previous[type] === undefined) emit.push(projection)
        types[type] = { projected_sol: projection.projectedSol }
      } else if (previous[type] !== undefined) {
        emit.push(resolvedPenalty(type, forEpoch, voteAccount))
        delete types[type]
      }
    }
  }
  return {
    emit,
    next: Object.keys(types).length > 0 ? { for_epoch: forEpoch, types } : null,
  }
}

export function evaluateProjectedDeltas<V>(
  validators: V[],
  previousState: Map<string, ValidatorState>,
  epoch: number,
  forEpoch: number,
  bondType: BondType,
  voteAccountOf: (v: V) => string,
  bondPubkeyOf: (v: V) => string,
  projectionOf: (v: V) => Projection,
): BondsEventV1[] {
  return validators.flatMap(v => {
    const voteAccount = voteAccountOf(v)
    return diffProjectedPenalties(
      previousState.get(voteAccount)?.projected_penalties,
      projectionOf(v),
      forEpoch,
      voteAccount,
    ).emit.map(p =>
      makeBaseEvent(
        'penalty_projected',
        voteAccount,
        bondPubkeyOf(v),
        epoch,
        bondType,
        p.message,
        p.details,
      ),
    )
  })
}
