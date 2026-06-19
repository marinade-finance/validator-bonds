// Ported from psr-dashboard `src/services/bond-coverage.ts` (branch 20260531_v2).
// Computes the bond-coverage primitives that feed the bond advice / CTA tips.
// Kept verbatim except for import paths and inlining `selectPaidUndelegationSol`
// (the dashboard sources it from its SAM selector; here it reads the same SDK
// field directly).
import { finite } from './format'

import type {
  AuctionValidator,
  DsSamConfig,
} from '@marinade.finance/ds-sam-sdk'

const selectPaidUndelegationSol = (v: AuctionValidator): number =>
  finite(v.values?.paidUndelegationSol)

export type BondCoverage = {
  minEp: number
  idealEp: number
  bondBalanceSol: number
  claimableBondBalanceSol: number
  marinadeActivatedStakeSol: number
  expectedMaxEffBidPmpe: number
  onchainDistributedPmpe: number
  currentExposedStakeSol: number
  projectedExposedStakeSol: number
  carriedPaidUndelegationSol: number
  minUnprotectedReserveSol: number
  idealUnprotectedReserveSol: number
  rewardsGuaranteeKeep: number
  rewardsGuaranteeIdeal: number
  minCoverageBidKeep: number
  heldForBidKeep: number
  heldForBidIdeal: number
  stakeKeepFloor: number
  topUpToKeepStake: number
  idealCoverageBidKeep: number
  stakeIdealFloor: number
  topUpToIdealKeep: number
  bondRiskFeeFloor: number
  bondRiskFeeShortfall: number
}

export function computeBondCoverage(
  v: AuctionValidator,
  config: DsSamConfig,
  winningTotalPmpe: number,
): BondCoverage {
  const bondBalanceSol = v.bondBalanceSol ?? 0
  const claimableBondBalanceSol = v.claimableBondBalanceSol ?? 0
  const marinadeActivatedStakeSol = v.marinadeActivatedStakeSol
  const paidUndelegationSol = selectPaidUndelegationSol(v)
  const expectedMaxEffBidPmpe = finite(v.revShare.expectedMaxEffBidPmpe)
  const onchainDistributedPmpe = finite(v.revShare.onchainDistributedPmpe)
  const unprotectedStakeSol = v.unprotectedStakeSol ?? 0

  const freshBondRiskUndel =
    (v.bondForcedUndelegation?.value ?? 0) * Math.min(1, config.bondRiskFeeMult)
  const freshBidTooLowUndel =
    winningTotalPmpe > 0
      ? ((v.revShare.bidTooLowPenaltyPmpe ?? 0) * marinadeActivatedStakeSol) /
        winningTotalPmpe
      : 0
  const carriedPaidUndelegationSol = Math.max(
    0,
    paidUndelegationSol - freshBondRiskUndel - freshBidTooLowUndel,
  )

  const projectedActivatedStakeSol = Math.max(
    0,
    marinadeActivatedStakeSol - carriedPaidUndelegationSol,
  )
  const projectedExposedStakeSol = Math.max(
    0,
    projectedActivatedStakeSol - unprotectedStakeSol,
  )

  const minUnprotectedReserveSol = finite(v.minUnprotectedReserve)
  const idealUnprotectedReserveSol = finite(v.idealUnprotectedReserve)

  const minEp = 1 + config.minBondEpochs
  const idealEp = 1 + config.idealBondEpochs

  const minBondPmpe = finite(v.minBondPmpe)
  const idealBondPmpe = finite(v.idealBondPmpe)

  const currentExposedStakeSol = Math.max(
    0,
    marinadeActivatedStakeSol - unprotectedStakeSol,
  )
  const minCoverageBidKeep =
    ((minEp * expectedMaxEffBidPmpe) / 1000) * currentExposedStakeSol
  const rewardsGuaranteeKeep =
    (onchainDistributedPmpe / 1000) * currentExposedStakeSol
  const heldForBidKeep = minCoverageBidKeep + minUnprotectedReserveSol
  const stakeKeepFloor =
    minUnprotectedReserveSol + (minBondPmpe / 1000) * currentExposedStakeSol
  const topUpToKeepStake = Math.max(0, stakeKeepFloor - claimableBondBalanceSol)

  const idealCoverageBidKeep =
    ((idealEp * expectedMaxEffBidPmpe) / 1000) * currentExposedStakeSol
  const rewardsGuaranteeIdeal = rewardsGuaranteeKeep
  const heldForBidIdeal = idealCoverageBidKeep + idealUnprotectedReserveSol
  const stakeIdealFloor =
    idealUnprotectedReserveSol + (idealBondPmpe / 1000) * currentExposedStakeSol
  const topUpToIdealKeep = Math.max(0, stakeIdealFloor - bondBalanceSol)

  const bondRiskFeeFloor =
    minUnprotectedReserveSol + (minBondPmpe / 1000) * projectedExposedStakeSol
  const bondRiskFeeShortfall = Math.max(
    0,
    bondRiskFeeFloor - claimableBondBalanceSol,
  )

  return {
    minEp,
    idealEp,
    bondBalanceSol,
    claimableBondBalanceSol,
    marinadeActivatedStakeSol,
    expectedMaxEffBidPmpe,
    onchainDistributedPmpe,
    currentExposedStakeSol,
    projectedExposedStakeSol,
    carriedPaidUndelegationSol,
    minUnprotectedReserveSol,
    idealUnprotectedReserveSol,
    rewardsGuaranteeKeep,
    rewardsGuaranteeIdeal,
    minCoverageBidKeep,
    heldForBidKeep,
    heldForBidIdeal,
    stakeKeepFloor,
    topUpToKeepStake,
    idealCoverageBidKeep,
    stakeIdealFloor,
    topUpToIdealKeep,
    bondRiskFeeFloor,
    bondRiskFeeShortfall,
  }
}
