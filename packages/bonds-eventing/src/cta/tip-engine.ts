// Bond-focused subset of the psr-dashboard CTA engine
// (`src/services/tip-engine.ts`, branch 20260531_v2), ported so the CLI shows
// the same advice the dashboard renders. The dashboard's getValidatorTip
// synthesises five CTA sources (bond, bid, out-of-set, cap, delta); here we
// keep the bond CTA (the one the spec pointed at: getValidatorTip → bondAdvice)
// plus a new "raise maxStakeWanted" CTA, and drop the bid/rank/delta sources
// which are dashboard-UI concerns and need SDK fields not present in 0.0.51.
//
// The dashboard's UI `tone` (CardStatusTone) is omitted — the CLI maps urgency
// to colour itself.
import { AuctionConstraintType } from '@marinade.finance/ds-sam-sdk'

import { computeBondCoverage } from './bond-coverage'
import {
  bondHealthFromAuction,
  BondHealthState,
  BOND_URGENT_EPOCHS,
} from './bond-health'
import { finite, pay, stake, topUp } from './format'

import type { BondCoverage } from './bond-coverage'
import type {
  AuctionValidator,
  DsSamConfig,
} from '@marinade.finance/ds-sam-sdk'

// Gate below which a validator is treated as not having "real" stake.
const NON_TRIVIAL_STAKE_SOL = 10_000
// Defend-lever gate: a loss smaller than this is not worth a defensive CTA.
const NON_TRIVIAL_LOSS_SOL = 1_000

export const TipUrgency = {
  CRITICAL: 'critical',
  WARNING: 'warning',
  INFO: 'info',
  POSITIVE: 'positive',
  NEUTRAL: 'neutral',
} as const
export type TipUrgency = (typeof TipUrgency)[keyof typeof TipUrgency]

export const TipConstraint = {
  RANK: 'rank',
  BOND: 'bond',
  BID: 'bid',
  CAP: 'cap',
  NONE: 'none',
} as const
export type TipConstraint = (typeof TipConstraint)[keyof typeof TipConstraint]

export interface ValidatorTip {
  text: string
  urgency: TipUrgency
  constraint: TipConstraint
  delta: number
  alert?: boolean
}

const SEVERITY_ORDER: Record<TipUrgency, number> = {
  critical: 0,
  warning: 1,
  info: 2,
  positive: 3,
  neutral: 4,
}

const LEVER_ORDER: Record<TipConstraint, number> = {
  bond: 0,
  bid: 1,
  rank: 1,
  cap: 2,
  none: 3,
}

function tip(
  text: string,
  urgency: TipUrgency,
  constraint: TipConstraint,
  delta: number,
  alert?: boolean,
): ValidatorTip {
  return alert
    ? { text, urgency, constraint, delta, alert }
    : { text, urgency, constraint, delta }
}

function isDefending(v: AuctionValidator, delta: number): boolean {
  return (
    (v.marinadeActivatedStakeSol ?? 0) > NON_TRIVIAL_STAKE_SOL &&
    delta < -NON_TRIVIAL_LOSS_SOL
  )
}

// A validator is "in set" when the auction targets it for some stake.
function inSet(v: AuctionValidator): boolean {
  return (v.auctionStake.marinadeSamTargetSol ?? 0) > 0
}

export type BondAdvice = {
  text: string
  urgency: TipUrgency
}

export function bondAdvice(
  coverage: BondCoverage,
  health: BondHealthState,
  bondRiskFeeSol: number,
  minBondBalanceSol: number,
  bondBalanceSol: number,
  marinadeActivatedStakeSol: number,
  nearFeeThreshold?: boolean,
): BondAdvice {
  if (
    bondBalanceSol < minBondBalanceSol &&
    health !== BondHealthState.NO_BOND
  ) {
    const isCharging = bondRiskFeeSol > 0
    return {
      text: `Top up bond to ${stake(minBondBalanceSol)} to qualify.`,
      urgency: isCharging ? TipUrgency.CRITICAL : TipUrgency.NEUTRAL,
    }
  }
  switch (health) {
    case BondHealthState.NO_BOND: {
      const hasRealStake = marinadeActivatedStakeSol > NON_TRIVIAL_STAKE_SOL
      return {
        text: `Post a bond of ${stake(minBondBalanceSol)} to win stake.`,
        urgency: hasRealStake ? TipUrgency.CRITICAL : TipUrgency.NEUTRAL,
      }
    }
    case BondHealthState.CRITICAL: {
      if (bondRiskFeeSol > 0) {
        const text =
          coverage.bondRiskFeeShortfall > 0
            ? `Top up ${topUp(coverage.bondRiskFeeShortfall)} or pay ${pay(bondRiskFeeSol)} bond fee.`
            : `Bond fee ${pay(bondRiskFeeSol)} estimated next epoch.`
        return { text, urgency: TipUrgency.CRITICAL }
      }
      if (coverage.bondRiskFeeShortfall > 0) {
        return {
          text: `Top up ${topUp(coverage.bondRiskFeeShortfall)} — bond below the penalty threshold.`,
          urgency: TipUrgency.CRITICAL,
        }
      }
      return {
        text: 'Bond below minimum — top up to maintain eligibility.',
        urgency: TipUrgency.CRITICAL,
      }
    }
    case BondHealthState.WATCH: {
      if (coverage.topUpToKeepStake > 0) {
        return {
          text: `Top up ${topUp(coverage.topUpToKeepStake)} to keep your stake.`,
          urgency: TipUrgency.WARNING,
        }
      }
      if (nearFeeThreshold) {
        return {
          text:
            coverage.topUpToIdealKeep > 0
              ? `Top up ${topUp(coverage.topUpToIdealKeep)} to avoid bond fee.`
              : 'Bond near threshold — top up to avoid bond fee.',
          urgency: TipUrgency.WARNING,
        }
      }
      if (coverage.topUpToIdealKeep > 0) {
        return {
          text: `Top up ${topUp(coverage.topUpToIdealKeep)} to grow stake.`,
          urgency: TipUrgency.INFO,
        }
      }
      return {
        text: 'Bond covers current stake.',
        urgency: TipUrgency.INFO,
      }
    }
    case BondHealthState.HEALTHY:
      return {
        text: 'Bond has enough coverage.',
        urgency: TipUrgency.POSITIVE,
      }
    default:
      return assertNever(health)
  }
}

export function bondCta(
  validator: AuctionValidator,
  dsSamConfig: DsSamConfig,
  winningTotalPmpe: number,
  delta: number,
  precomputedCoverage?: BondCoverage,
): ValidatorTip | null {
  const bondBalance = validator.bondBalanceSol ?? 0
  const bondRiskFeeSol = validator.values?.bondRiskFeeSol ?? 0
  const coverage =
    precomputedCoverage ??
    computeBondCoverage(validator, dsSamConfig, winningTotalPmpe)

  if (bondBalance < dsSamConfig.minBondBalanceSol) {
    if (bondRiskFeeSol > 0) {
      const topUpAmt = Math.max(
        coverage.bondRiskFeeShortfall,
        dsSamConfig.minBondBalanceSol - bondBalance,
      )
      return tip(
        `Top up ${topUp(topUpAmt)} to avoid next epoch bond fee and re-qualify.`,
        TipUrgency.CRITICAL,
        TipConstraint.BOND,
        delta,
        true,
      )
    }
    return tip(
      bondBalance <= 0
        ? `Post a bond of ${stake(dsSamConfig.minBondBalanceSol)} to qualify.`
        : `Top up bond to ${stake(dsSamConfig.minBondBalanceSol)} to qualify.`,
      isDefending(validator, delta) ? TipUrgency.WARNING : TipUrgency.NEUTRAL,
      TipConstraint.BOND,
      delta,
    )
  }

  const health = bondHealthFromAuction(
    validator,
    dsSamConfig,
    winningTotalPmpe,
    coverage,
  )
  const runway = validator.bondGoodForNEpochs ?? 0
  const nearFeeThreshold =
    health === BondHealthState.WATCH &&
    runway <= dsSamConfig.minBondEpochs + BOND_URGENT_EPOCHS &&
    coverage.bondRiskFeeShortfall === 0
  const fires =
    health === BondHealthState.CRITICAL ||
    (inSet(validator) &&
      health === BondHealthState.WATCH &&
      (coverage.topUpToKeepStake > 0 ||
        nearFeeThreshold ||
        (coverage.topUpToIdealKeep > 0 && delta <= 0)))
  if (!fires) return null
  if (
    health === BondHealthState.WATCH &&
    coverage.topUpToKeepStake === 0 &&
    !nearFeeThreshold &&
    isDefending(validator, delta)
  ) {
    const topUpAmt = coverage.topUpToIdealKeep
    return tip(
      topUpAmt > 0
        ? `Top up ${topUp(topUpAmt)} to keep your stake.`
        : 'Top up bond to keep your stake.',
      TipUrgency.WARNING,
      TipConstraint.BOND,
      delta,
    )
  }
  const advice = bondAdvice(
    coverage,
    health,
    bondRiskFeeSol,
    dsSamConfig.minBondBalanceSol,
    bondBalance,
    validator.marinadeActivatedStakeSol,
    nearFeeThreshold,
  )
  return tip(
    advice.text,
    advice.urgency,
    TipConstraint.BOND,
    delta,
    health === BondHealthState.CRITICAL && bondRiskFeeSol > 0,
  )
}

// Estimate the maximum stake the validator's *current* claimable bond can
// sustain at the keep floor, by inverting `stakeKeepFloor`
// (= minUnprotectedReserve + minBondPmpe/1000 * exposedStake). Returns null when
// the bond does not limit stake (no per-stake bid cost), in which case any bond
// is "enough" and the advice is qualitative. This mirrors the dashboard's keep
// model; the reserve term is held at its current value, so it is an estimate.
function bondSupportedStakeSol(
  v: AuctionValidator,
  coverage: BondCoverage,
): number | null {
  const minBondPmpe = finite(v.minBondPmpe)
  if (minBondPmpe <= 0) return null
  const exposedMax = Math.max(
    0,
    ((coverage.claimableBondBalanceSol - coverage.minUnprotectedReserveSol) *
      1000) /
      minBondPmpe,
  )
  const unprotectedStakeSol = Math.max(
    0,
    coverage.marinadeActivatedStakeSol - coverage.currentExposedStakeSol,
  )
  return exposedMax + unprotectedStakeSol
}

// New CTA (not in the dashboard): when the validator is held back purely by its
// own `maxStakeWanted` (WANT cap) and the bond already covers more stake, tell
// them how much extra they could win by raising it.
export function raiseWantCta(
  v: AuctionValidator,
  coverage: BondCoverage,
  delta: number,
): ValidatorTip | null {
  const cap = v.lastCapConstraint
  if (cap == null || cap.constraintType !== AuctionConstraintType.WANT) {
    return null
  }
  // Underfunded validators are bondCta's job (higher severity); only nudge when
  // the bond comfortably covers the current allocation.
  if (coverage.topUpToKeepStake > 0 || coverage.bondRiskFeeShortfall > 0) {
    return null
  }

  const target = v.auctionStake.marinadeSamTargetSol ?? 0
  const headroom = bondSupportedStakeSol(v, coverage)
  if (headroom === null) {
    return tip(
      'Your `maxStakeWanted` is the only limit — raise it to receive more stake.',
      TipUrgency.INFO,
      TipConstraint.CAP,
      delta,
    )
  }
  const extra = headroom - target
  if (extra < NON_TRIVIAL_STAKE_SOL) return null
  return tip(
    `Your bond already covers more — raise \`maxStakeWanted\` to gain up to +${stake(extra)} stake.`,
    TipUrgency.INFO,
    TipConstraint.CAP,
    delta,
  )
}

// Compute the single highest-severity bond/cap tip for a validator, or null if
// there is nothing actionable to say.
export function getBondTip(
  v: AuctionValidator,
  config: DsSamConfig,
  winningTotalPmpe: number,
): ValidatorTip | null {
  const coverage = computeBondCoverage(v, config, winningTotalPmpe)
  const delta =
    (v.auctionStake.marinadeSamTargetSol ?? 0) - v.marinadeActivatedStakeSol
  const candidates = [
    bondCta(v, config, winningTotalPmpe, delta, coverage),
    raiseWantCta(v, coverage, delta),
  ].filter((c): c is ValidatorTip => c !== null)
  candidates.sort(
    (a, b) =>
      SEVERITY_ORDER[a.urgency] - SEVERITY_ORDER[b.urgency] ||
      LEVER_ORDER[a.constraint] - LEVER_ORDER[b.constraint],
  )
  return candidates[0] ?? null
}

function assertNever(x: never): never {
  throw new Error(`Unexpected bond health state: ${String(x)}`)
}
