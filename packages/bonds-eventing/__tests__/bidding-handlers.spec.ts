import { readFileSync } from 'fs'
import { join } from 'path'

import pino from 'pino'

import { biddingHandlers } from '../src/commands/bidding'

import type { AuctionMeta } from '../src/calc-relay'
import type { BondsEventV1, ValidatorState } from '../src/types'
import type { VatForecast } from '../src/vat-forecast'
import type { AuctionValidator } from '@marinade.finance/ds-sam-sdk'

const logger = pino({ level: 'silent' })

const fixture = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures', 'penalty-projection-jnggar-1081.json'),
    'utf8',
  ),
) as {
  preDrainBondSol: number
  winningTotalPmpe: number
  config: Record<string, number>
  validator: AuctionValidator
}

const EPOCH = 1081
const VOTE = fixture.validator.voteAccount

const meta = {
  ...fixture.config,
  winningTotalPmpe: fixture.winningTotalPmpe,
} as unknown as AuctionMeta

function validator(overrides: Record<string, unknown> = {}): AuctionValidator {
  return structuredClone({
    ...fixture.validator,
    samEligible: true,
    samBlocked: false,
    lastCapConstraint: null,
    bondGoodForNEpochs: 1.15,
    bondBalanceSol: fixture.preDrainBondSol,
    claimableBondBalanceSol: fixture.preDrainBondSol,
    values: { ...fixture.validator.values, bondRiskFeeSol: 0 },
    ...overrides,
  })
}

const unpublished = () =>
  validator({
    auctions: fixture.validator.auctions.map(a => ({
      ...a,
      epoch: a.epoch - 1,
    })),
  })

function vat(eligible: boolean): VatForecast {
  return {
    epoch: EPOCH,
    inflationPmpe: 0.15,
    minVoteBalanceSol: 0.82,
    byVoteAccount: new Map([
      [VOTE, { eligible, reason: eligible ? null : 'low_balance' }],
    ]),
  }
}

function run(
  v: AuctionValidator,
  previous: ValidatorState | undefined,
  forecast: VatForecast | null,
): { events: BondsEventV1[]; state: ValidatorState } {
  const { evaluate, toState } = biddingHandlers(meta, forecast, logger)
  const previousState = new Map<string, ValidatorState>()
  if (previous) previousState.set(VOTE, previous)
  return {
    events: evaluate([v], previousState, EPOCH),
    state: toState(v, EPOCH, previous),
  }
}

const projectedTypes = (events: BondsEventV1[]) =>
  events
    .filter(e => e.inner_type === 'penalty_projected')
    .map(e => (e.data.details as { penalty_type: string }).penalty_type)

describe('biddingHandlers', () => {
  it('a first-seen validator gets first_seen and its projections', () => {
    const { events } = run(validator(), undefined, vat(false))
    expect(events.map(e => e.inner_type)).toContain('first_seen')
    expect(projectedTypes(events).sort()).toEqual([
      'bond_risk_fee',
      'vat_unadmitted',
    ])
  })

  it('an unchanged projection is announced on the first run only', () => {
    const first = run(validator(), undefined, vat(false))
    expect(first.state.projected_penalties).toEqual({
      for_epoch: EPOCH + 1,
      types: {
        bond_risk_fee: { projected_sol: expect.any(Number) },
        vat_unadmitted: { projected_sol: expect.any(Number) },
      },
    })
    const second = run(validator(), first.state, vat(false))
    expect(projectedTypes(second.events)).toEqual([])
    expect(second.state.projected_penalties).toEqual(
      first.state.projected_penalties,
    )
  })

  it('a failed VAT fetch keeps the VAT entry and resolves nothing', () => {
    const first = run(validator(), undefined, vat(false))
    const second = run(validator(), first.state, null)
    expect(projectedTypes(second.events)).toEqual([])
    expect(second.state.projected_penalties!.types.vat_unadmitted).toEqual(
      first.state.projected_penalties!.types.vat_unadmitted,
    )
  })

  it('a top-up resolves the bond risk fee projection', () => {
    const first = run(validator(), undefined, vat(true))
    const toppedUp = validator({
      bondBalanceSol: fixture.preDrainBondSol + 10,
      claimableBondBalanceSol: fixture.preDrainBondSol + 10,
    })
    const second = run(toppedUp, first.state, vat(true))
    const resolved = second.events.filter(
      e => e.inner_type === 'penalty_projected',
    )
    expect(resolved).toHaveLength(1)
    expect(resolved[0]!.data.details).toEqual({
      penalty_type: 'bond_risk_fee',
      for_epoch: EPOCH + 1,
      projected_sol: 0,
    })
    expect(second.state.projected_penalties).toBeNull()
  })

  it('one run never yields penalty_expected and a SAM penalty_projected together', () => {
    const previous = {
      ...run(validator(), undefined, vat(true)).state,
      projected_penalties: null,
    }
    const charged = { values: { ...fixture.validator.values } }

    const beforePublication = run(
      validator({ ...charged, auctions: unpublished().auctions }),
      previous,
      vat(true),
    )
    expect(beforePublication.events.map(e => e.inner_type)).toContain(
      'penalty_expected',
    )
    expect(projectedTypes(beforePublication.events)).toEqual([])
    expect(beforePublication.state.expected_penalties).toEqual({
      epoch: EPOCH,
      kinds: ['bond_risk_fee'],
    })

    const afterPublication = run(validator(charged), previous, vat(true))
    expect(afterPublication.events.map(e => e.inner_type)).not.toContain(
      'penalty_expected',
    )
    expect(projectedTypes(afterPublication.events)).toEqual(['bond_risk_fee'])
  })
})
