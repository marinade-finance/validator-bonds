// Ported from psr-dashboard `src/services/bond-health.ts` (branch 20260531_v2).
// Classifies a validator's bond into the four health tiers that drive the CTA.
import { computeBondCoverage } from './bond-coverage'

import type { BondCoverage } from './bond-coverage'
import type {
  AuctionValidator,
  DsSamConfig,
} from '@marinade.finance/ds-sam-sdk'

// Runway window between the penalty threshold and the red chip.
// Validators not paying yet but within this many epochs of the threshold
// get the red "top up urgently" pill.
export const BOND_URGENT_EPOCHS = 3

// Four tiers driving the bond chip color and the page-level CTA:
//   no-bond  → no bond posted at all (red)
//   critical → fee charging now, OR runway ≤ minBondEpochs + BOND_URGENT_EPOCHS (red, urgent)
//   watch    → runway between urgent threshold and idealBondEpochs (yellow)
//   healthy  → runway above idealBondEpochs (green)
export const BondHealthState = {
  NO_BOND: 'no-bond',
  CRITICAL: 'critical',
  WATCH: 'watch',
  HEALTHY: 'healthy',
} as const
export type BondHealthState =
  (typeof BondHealthState)[keyof typeof BondHealthState]

export function bondHealthFromAuction(
  v: AuctionValidator,
  config: DsSamConfig,
  winningTotalPmpe: number,
  // Optional precomputed coverage. Callers that already computed it (e.g.
  // tip-engine's bondCta) can pass it through instead of forcing a second
  // call here.
  precomputedCoverage?: BondCoverage,
): BondHealthState {
  const bondBalance = v.bondBalanceSol ?? 0
  if (bondBalance <= 0) return BondHealthState.NO_BOND
  // Below the SDK minimum the validator can win no stake regardless of bid
  // (clipBondStakeCap → 0). Runway-vs-tiny-stake looks huge, so the
  // coverage-based diagnosis below would mislabel it healthy — gate it red here.
  if (bondBalance < config.minBondBalanceSol) return BondHealthState.CRITICAL
  if (!v.auctionStake.marinadeSamTargetSol && !v.marinadeActivatedStakeSol) {
    return BondHealthState.HEALTHY
  }
  const coverage =
    precomputedCoverage ?? computeBondCoverage(v, config, winningTotalPmpe)
  if (coverage.bondRiskFeeShortfall > 0) return BondHealthState.CRITICAL
  if (v.values.bondRiskFeeSol > 0) return BondHealthState.CRITICAL
  // Below ideal coverage → yellow watch. Includes the BOND_URGENT_EPOCHS
  // near-threshold zone: urgency is expressed through the CTA message
  // ("avoid future bond fee") not through red chip color, since no fee fires.
  const runway = v.bondGoodForNEpochs ?? 0
  if (runway < config.idealBondEpochs) return BondHealthState.WATCH
  return BondHealthState.HEALTHY
}
