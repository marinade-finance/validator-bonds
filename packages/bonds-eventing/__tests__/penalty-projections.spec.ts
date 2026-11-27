import { readFileSync } from 'fs'
import { join } from 'path'

import {
  diffProjectedPenalties,
  evaluateProjectedDeltas,
  projectSamPenalties,
  projectVatPenalty,
} from '../src/penalty-projections'

import type { AuctionMeta } from '../src/calc-relay'
import type { ProjectedPenalty, Projection } from '../src/penalty-projections'
import type { PenaltyType, ValidatorState } from '../src/types'
import type { VatForecast } from '../src/vat-forecast'
import type { AuctionValidator } from '@marinade.finance/ds-sam-sdk'

const fixture = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures', 'penalty-projection-jnggar-1081.json'),
    'utf8',
  ),
) as {
  preDrainBondSol: number
  actualDrainSol: number
  actualFeeSol: number
  winningTotalPmpe: number
  config: Record<string, number>
  validator: AuctionValidator
}

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
  })
}

function withDrainPmpe(v: AuctionValidator, pmpe: number): AuctionValidator {
  v.auctions[0]!.auctionEffectiveBidPmpe = pmpe
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

  it('a validator that lost the auction drains its own bid, not the participation threshold', () => {
    const loser = withDrainPmpe(jnggar(), 0.005)
    expect(loser.auctions[0]!.effParticipatingBidPmpe).toBeGreaterThan(0.02)
    expect(bondRiskFee(loser)).toBeUndefined()
  })

  it('a bond the drain empties is still projected, as the auction gates on the prior balance', () => {
    const projection = bondRiskFee(
      jnggar({ bondBalanceSol: 6, claimableBondBalanceSol: 6 }),
    )
    expect(projection).toBeDefined()
    expect(projection!.details.pending_drain_sol).toBeGreaterThan(5)
    expect(projection!.projectedSol).toBeGreaterThan(0)
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

function vatForecast(
  eligible: boolean | null,
  reason: string | null,
  epoch = 1097,
): VatForecast {
  return {
    epoch,
    inflationPmpe: 0.15,
    minVoteBalanceSol: 0.8197612,
    byVoteAccount: new Map([['vote1', { eligible, reason }]]),
  }
}

describe('projectVatPenalty', () => {
  it('projects one epoch of inflation on the stake when VAT fails', () => {
    const projected = projectVatPenalty(
      vatForecast(false, 'low_balance'),
      'vote1',
      20000,
      'bidding',
      1097,
    )!
    expect(projected).toHaveLength(1)
    expect(projected[0]!.projectedSol).toBeCloseTo(3, 9)
    expect(projected[0]!.details).toMatchObject({
      penalty_type: 'vat_unadmitted',
      for_epoch: 1098,
      vat_rejection_reason: 'low_balance',
      inflation_pmpe: 0.15,
      stake_sol: 20000,
    })
    expect(projected[0]!.message).toContain('~3 SOL')
    expect(projected[0]!.message).toContain('at least 0.8198 SOL')
    expect(projected[0]!.message).toContain('leaves SAM')
  })

  it('rounds the minimum vote balance up, as the VAT check is strict', () => {
    const projected = projectVatPenalty(
      { ...vatForecast(false, 'low_balance'), minVoteBalanceSol: 0.81972 },
      'vote1',
      20000,
      'bidding',
      1097,
    )!
    expect(projected[0]!.message).toContain(
      'at least 0.8198 SOL, not counting pending delegator rewards.',
    )
  })

  it('the institutional message names the action without SAM', () => {
    const projected = projectVatPenalty(
      vatForecast(false, 'no_bls_key'),
      'vote1',
      20000,
      'institutional',
      1097,
    )!
    expect(projected[0]!.message).toContain('Register a BLS key')
    expect(projected[0]!.message).not.toContain('SAM')
  })

  it('an eligible verdict projects nothing', () => {
    expect(
      projectVatPenalty(
        vatForecast(true, null),
        'vote1',
        20000,
        'bidding',
        1097,
      ),
    ).toEqual([])
  })

  it('an unknown verdict is not evaluated, so a stored projection is kept', () => {
    expect(
      projectVatPenalty(
        vatForecast(null, null),
        'vote1',
        20000,
        'bidding',
        1097,
      ),
    ).toBeNull()
  })

  it('is not evaluated for another epoch or a missing vote account', () => {
    const forecast = vatForecast(false, 'low_balance', 1096)
    expect(
      projectVatPenalty(forecast, 'vote1', 20000, 'bidding', 1097),
    ).toBeNull()
    expect(
      projectVatPenalty(
        vatForecast(false, 'low_balance'),
        'other',
        1,
        'bidding',
        1097,
      ),
    ).toBeNull()
  })
})

function penalty(
  penaltyType: PenaltyType,
  projectedSol: number,
): ProjectedPenalty {
  return {
    penaltyType,
    projectedSol,
    message: `${penaltyType} ${projectedSol}`,
    details: {
      penalty_type: penaltyType,
      for_epoch: 1098,
      projected_sol: projectedSol,
    },
  }
}

describe('diffProjectedPenalties', () => {
  const none: Projection = { sam: [], vat: [] }

  it('emits a type that appears', () => {
    const { emit, next } = diffProjectedPenalties(
      null,
      { sam: [penalty('bond_risk_fee', 5)], vat: [] },
      1098,
      'vote1',
    )
    expect(emit.map(p => p.penaltyType)).toEqual(['bond_risk_fee'])
    expect(next).toEqual({
      for_epoch: 1098,
      types: { bond_risk_fee: { projected_sol: 5 } },
    })
  })

  it('a grown amount of a known type emits nothing and refreshes the state', () => {
    const { emit, next } = diffProjectedPenalties(
      { for_epoch: 1098, types: { bond_risk_fee: { projected_sol: 5 } } },
      { sam: [penalty('bond_risk_fee', 50)], vat: [] },
      1098,
      'vote1',
    )
    expect(emit).toEqual([])
    expect(next!.types.bond_risk_fee).toEqual({ projected_sol: 50 })
  })

  it('a type that disappears emits one resolved projection', () => {
    const { emit, next } = diffProjectedPenalties(
      { for_epoch: 1098, types: { bid_too_low: { projected_sol: 25 } } },
      none,
      1098,
      'vote1',
    )
    expect(emit).toHaveLength(1)
    expect(emit[0]!.details).toEqual({
      penalty_type: 'bid_too_low',
      for_epoch: 1098,
      projected_sol: 0,
    })
    expect(next).toBeNull()
  })

  it('a type that reappears after it resolved emits again', () => {
    const { emit } = diffProjectedPenalties(
      null,
      { sam: [penalty('bid_too_low', 25)], vat: [] },
      1098,
      'vote1',
    )
    expect(emit).toHaveLength(1)
  })

  it('a new for_epoch announces the type again and resolves nothing of the old one', () => {
    const { emit } = diffProjectedPenalties(
      { for_epoch: 1097, types: { blacklist: { projected_sol: 8 } } },
      { sam: [penalty('blacklist', 8)], vat: [] },
      1098,
      'vote1',
    )
    expect(emit.map(p => p.details.projected_sol)).toEqual([8])
  })

  it('a group that was not evaluated keeps its entries and emits nothing', () => {
    const prev = {
      for_epoch: 1098,
      types: {
        bond_risk_fee: { projected_sol: 5 },
        vat_unadmitted: { projected_sol: 3 },
      },
    }
    expect(
      diffProjectedPenalties(prev, { sam: null, vat: [] }, 1098, 'vote1'),
    ).toEqual({
      emit: [
        expect.objectContaining({
          projectedSol: 0,
          penaltyType: 'vat_unadmitted',
        }),
      ],
      next: { for_epoch: 1098, types: { bond_risk_fee: { projected_sol: 5 } } },
    })
    expect(
      diffProjectedPenalties(prev, { sam: [], vat: null }, 1098, 'vote1'),
    ).toEqual({
      emit: [
        expect.objectContaining({
          projectedSol: 0,
          penaltyType: 'bond_risk_fee',
        }),
      ],
      next: {
        for_epoch: 1098,
        types: { vat_unadmitted: { projected_sol: 3 } },
      },
    })
  })

  it('nothing evaluated keeps the stored state, whatever the for_epoch', () => {
    const prev = {
      for_epoch: 1097,
      types: { vat_unadmitted: { projected_sol: 3 } },
    }
    expect(
      diffProjectedPenalties(prev, { sam: null, vat: null }, 1098, 'vote1'),
    ).toEqual({ emit: [], next: prev })
  })

  it('two new types in one run emit two projections', () => {
    const { emit } = diffProjectedPenalties(
      null,
      {
        sam: [penalty('bid_too_low', 25)],
        vat: [penalty('vat_unadmitted', 3)],
      },
      1098,
      'vote1',
    )
    expect(emit.map(p => p.penaltyType)).toEqual([
      'bid_too_low',
      'vat_unadmitted',
    ])
  })
})

describe('evaluateProjectedDeltas', () => {
  it('maps the emitted projections to penalty_projected events', () => {
    const previousState = new Map<string, ValidatorState>()
    const events = evaluateProjectedDeltas(
      [{ vote: 'vote1' }],
      previousState,
      1097,
      1098,
      'bidding',
      v => v.vote,
      () => 'bond1',
      () => ({ sam: [penalty('bond_risk_fee', 5)], vat: [] }),
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      inner_type: 'penalty_projected',
      vote_account: 'vote1',
      bond_pubkey: 'bond1',
      bond_type: 'bidding',
      epoch: 1097,
      data: {
        message: 'bond_risk_fee 5',
        details: {
          penalty_type: 'bond_risk_fee',
          for_epoch: 1098,
          projected_sol: 5,
        },
      },
    })
  })
})
