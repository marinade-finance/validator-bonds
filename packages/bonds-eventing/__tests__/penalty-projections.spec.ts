import fixture from './fixtures/penalty-projection-jnggar-1081.json'
import { projectSamPenalties } from '../src/penalty-projections'

import type { AuctionMeta } from '../src/calc-relay'
import type { AuctionValidator } from '@marinade.finance/ds-sam-sdk'

const EPOCH = 1081

const meta = {
  ...fixture.config,
  winningTotalPmpe: fixture.winningTotalPmpe,
} as unknown as AuctionMeta

function jnggar(overrides: Record<string, unknown> = {}): AuctionValidator {
  return structuredClone({
    ...fixture.validator,
    bondBalanceSol: fixture.preDrainBondSol,
    claimableBondBalanceSol: fixture.preDrainBondSol,
    ...overrides,
  }) as unknown as AuctionValidator
}

function withDrainPmpe(v: AuctionValidator, pmpe: number): AuctionValidator {
  v.auctions[0]!.effParticipatingBidPmpe = pmpe
  return v
}

function bondRiskFee(v: AuctionValidator) {
  return projectSamPenalties(v, EPOCH, meta)!.find(
    p => p.penaltyType === 'bond_risk_fee',
  )
}

describe('projectSamPenalties', () => {
  it('is not evaluated until the auction of the epoch is published', () => {
    expect(projectSamPenalties(jnggar(), EPOCH + 1, meta)).toBeNull()
    expect(
      projectSamPenalties(jnggar({ auctions: [] }), EPOCH, meta),
    ).toBeNull()
  })

  it('without a pending drain reproduces the live run fee', () => {
    const live = jnggar({
      bondBalanceSol: fixture.validator.bondBalanceSol,
      claimableBondBalanceSol: fixture.validator.claimableBondBalanceSol,
    })
    const projection = bondRiskFee(withDrainPmpe(live, 0))
    expect(projection!.projectedSol).toBeCloseTo(
      fixture.validator.values.bondRiskFeeSol,
      6,
    )
  })

  it('projects the epoch 1082 fee of JnGGar3X… from its epoch 1081 bond', () => {
    const projection = bondRiskFee(jnggar())
    expect(projection).toBeDefined()
    expect(projection!.details.for_epoch).toBe(1082)
    expect(projection!.details.pending_drain_sol).toBeCloseTo(
      fixture.actualDrainSol,
      1,
    )
    expect(
      Math.abs(projection!.projectedSol - fixture.actualFeeSol) /
        fixture.actualFeeSol,
    ).toBeLessThan(0.1)
    expect(projection!.details.top_up_sol).toBeGreaterThan(0)
    expect(projection!.message).toContain('Top up ~')
  })

  it('the projected top-up clears the fee', () => {
    const topUp = bondRiskFee(jnggar())!.details.top_up_sol!
    const toppedUp = fixture.preDrainBondSol + topUp + 0.001
    expect(
      bondRiskFee(
        jnggar({ bondBalanceSol: toppedUp, claimableBondBalanceSol: toppedUp }),
      ),
    ).toBeUndefined()
  })

  it('a drain just short of the trigger projects no fee', () => {
    const topUp = bondRiskFee(jnggar())!.details.top_up_sol!
    const drain = bondRiskFee(jnggar())!.details.pending_drain_sol!
    const stake = fixture.validator.marinadeActivatedStakeSol
    const shortPmpe = ((drain - topUp - 0.01) * 1000) / stake
    expect(bondRiskFee(withDrainPmpe(jnggar(), shortPmpe))).toBeUndefined()
    const crossingPmpe = ((drain - topUp + 0.01) * 1000) / stake
    expect(bondRiskFee(withDrainPmpe(jnggar(), crossingPmpe))).toBeDefined()
  })

  it('projects bid-too-low and blacklist from the live penalty PMPE', () => {
    const v = jnggar({
      marinadeActivatedStakeSol: 50000,
      revShare: {
        ...fixture.validator.revShare,
        bidTooLowPenaltyPmpe: 0.5,
        blacklistPenaltyPmpe: 0.5,
        bidPmpe: 0.05,
      },
    })
    const projections = projectSamPenalties(v, EPOCH, meta)!
    const bidTooLow = projections.find(p => p.penaltyType === 'bid_too_low')!
    expect(bidTooLow.projectedSol).toBe(25)
    expect(bidTooLow.details.restore_bid_pmpe).toBe(
      fixture.validator.auctions[0]!.bidPmpe,
    )
    expect(bidTooLow.details.bid_pmpe).toBe(0.05)
    const blacklist = projections.find(p => p.penaltyType === 'blacklist')!
    expect(blacklist.projectedSol).toBe(25)
  })

  it('drops sub-dust amounts', () => {
    const v = jnggar({
      revShare: {
        ...fixture.validator.revShare,
        bidTooLowPenaltyPmpe: 0.00000001,
        blacklistPenaltyPmpe: 0,
      },
    })
    const types = projectSamPenalties(v, EPOCH, meta)!.map(p => p.penaltyType)
    expect(types).toEqual(['bond_risk_fee'])
  })

  it('does not mutate the live validator', () => {
    const v = jnggar()
    const before = structuredClone(v)
    projectSamPenalties(v, EPOCH, meta)
    expect(v).toEqual(before)
  })
})
