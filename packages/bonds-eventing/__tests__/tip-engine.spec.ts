import { AuctionConstraintType } from '@marinade.finance/ds-sam-sdk'

import { getBondTip } from '../src/cta/tip-engine'

import type {
  AuctionValidator,
  DsSamConfig,
} from '@marinade.finance/ds-sam-sdk'

const WINNING_PMPE = 1000

const config = {
  minBondBalanceSol: 10,
  minBondEpochs: 1,
  idealBondEpochs: 3,
  bondRiskFeeMult: 1,
} as unknown as DsSamConfig

// Minimal AuctionValidator covering only the fields the bond CTA reads.
function makeV(overrides: Record<string, unknown> = {}): AuctionValidator {
  const base = {
    voteAccount: 'Vote1111111111111111111111111111111111111111',
    bondBalanceSol: 100,
    claimableBondBalanceSol: 100,
    marinadeActivatedStakeSol: 50_000,
    unprotectedStakeSol: 0,
    minUnprotectedReserve: 0,
    idealUnprotectedReserve: 0,
    minBondPmpe: 1,
    idealBondPmpe: 1,
    bondGoodForNEpochs: 10,
    bondForcedUndelegation: { value: 0 },
    auctionStake: { marinadeSamTargetSol: 50_000 },
    lastCapConstraint: null,
    values: { bondRiskFeeSol: 0, paidUndelegationSol: 0 },
    revShare: {
      expectedMaxEffBidPmpe: 0,
      onchainDistributedPmpe: 0,
      bidTooLowPenaltyPmpe: 0,
    },
  }
  return { ...base, ...overrides } as unknown as AuctionValidator
}

const wantCap = {
  constraintType: AuctionConstraintType.WANT,
  constraintName: 'WANT',
  totalStakeSol: 0,
  totalLeftToCapSol: 0,
  marinadeStakeSol: 50_000,
  marinadeLeftToCapSol: 0,
  validators: [],
}

describe('getBondTip', () => {
  it('tells a bondless validator to post a bond', () => {
    const tip = getBondTip(
      makeV({ bondBalanceSol: 0, claimableBondBalanceSol: 0 }),
      config,
      WINNING_PMPE,
    )
    expect(tip?.text).toBe('Post a bond of 10 SOL to qualify.')
    expect(tip?.constraint).toBe('bond')
  })

  it('tells an underfunded validator how much to top up to keep stake', () => {
    // High keep-floor (minBondPmpe) but no projected exposure (all stake is
    // being undelegated this epoch) keeps it WATCH rather than CRITICAL.
    const tip = getBondTip(
      makeV({
        bondBalanceSol: 20,
        claimableBondBalanceSol: 20,
        minBondPmpe: 10,
        bondGoodForNEpochs: 1,
        values: { bondRiskFeeSol: 0, paidUndelegationSol: 50_000 },
      }),
      config,
      WINNING_PMPE,
    )
    expect(tip?.text).toBe('Top up 480 SOL to keep your stake.')
    expect(tip?.urgency).toBe('warning')
  })

  it('suggests raising maxStakeWanted when the bond covers more (WANT cap)', () => {
    const tip = getBondTip(
      makeV({ lastCapConstraint: wantCap }),
      config,
      WINNING_PMPE,
    )
    // headroom = claimable(100)/(minBondPmpe 1 / 1000) = 100,000; target 50,000
    expect(tip?.text).toBe(
      'Your bond already covers more — raise `maxStakeWanted` to gain up to +50,000 SOL stake.',
    )
    expect(tip?.constraint).toBe('cap')
    expect(tip?.urgency).toBe('info')
  })

  it('stays silent for a healthy, want-satisfied validator with no headroom', () => {
    const tip = getBondTip(makeV(), config, WINNING_PMPE)
    expect(tip).toBeNull()
  })
})
