import { jsonSafe, toCalcValidator } from '../src/calc-relay'

import type { AuctionValidator } from '@marinade.finance/ds-sam-sdk'

function calcValidator(
  overrides: Record<string, unknown> = {},
): AuctionValidator {
  return {
    voteAccount: '11111111111111111111111111111112',
    bondBalanceSol: 10,
    claimableBondBalanceSol: 9,
    marinadeActivatedStakeSol: 50000,
    unprotectedStakeSol: 0,
    maxStakeWanted: null,
    samEligible: true,
    samBlocked: false,
    minBondPmpe: 4.2,
    idealBondPmpe: 12.5,
    minUnprotectedReserve: 0,
    idealUnprotectedReserve: 0,
    bondGoodForNEpochs: 5,
    unstakePriority: 1,
    maxBondDelegation: 60000,
    bondSamStakeCapSol: 60000,
    auctionStake: { marinadeSamTargetSol: 1000, externalActivatedSol: 0 },
    bondForcedUndelegation: { value: 3, coef: 0, base: 0 },
    revShare: {
      totalPmpe: 20,
      expectedMaxEffBidPmpe: 3.2,
      onchainDistributedPmpe: 0.5,
      bidPmpe: 1,
      effParticipatingBidPmpe: 1,
      bondObligationPmpe: 0,
      bidTooLowPenaltyPmpe: 0,
      blacklistPenaltyPmpe: 0,
    },
    values: { bondRiskFeeSol: 0, paidUndelegationSol: 0 },
    lastCapConstraint: null,
    auctions: [{ bidPmpe: 1, effParticipatingBidPmpe: 1 }],
    ...overrides,
  } as unknown as AuctionValidator
}

describe('jsonSafe', () => {
  it('coerces NaN and ±Infinity to null', () => {
    expect(jsonSafe(NaN)).toBeNull()
    expect(jsonSafe(Infinity)).toBeNull()
    expect(jsonSafe(-Infinity)).toBeNull()
  })

  it('preserves finite numbers, strings, booleans, and null', () => {
    expect(jsonSafe(1.5)).toBe(1.5)
    expect(jsonSafe(0)).toBe(0)
    expect(jsonSafe('x')).toBe('x')
    expect(jsonSafe(true)).toBe(true)
    expect(jsonSafe(null)).toBeNull()
  })

  it('recurses into nested arrays and objects', () => {
    expect(jsonSafe({ a: NaN, b: [1, Infinity, { c: -Infinity }] })).toEqual({
      a: null,
      b: [1, null, { c: null }],
    })
  })

  it('produces JSON-serializable output (the slonik strict-stringify hazard)', () => {
    const out = jsonSafe({ a: NaN, b: [Infinity] })
    expect(() => JSON.stringify(out)).not.toThrow()
    expect(JSON.stringify(out)).toBe('{"a":null,"b":[null]}')
  })
})

describe('toCalcValidator', () => {
  it('relays the fields ds-sam-calc reads', () => {
    const blob = toCalcValidator(calcValidator())
    expect(blob.voteAccount).toBe('11111111111111111111111111111112')
    expect(blob.minBondPmpe).toBe(4.2)
    expect(blob.idealBondPmpe).toBe(12.5)
    expect(blob.bondGoodForNEpochs).toBe(5)
    expect(blob.unstakePriority).toBe(1)
    expect(blob.maxBondDelegation).toBe(60000)
    expect(blob.bondSamStakeCapSol).toBe(60000)
    expect(
      (blob.auctionStake as Record<string, unknown>).marinadeSamTargetSol,
    ).toBe(1000)
    expect((blob.bondForcedUndelegation as Record<string, unknown>).value).toBe(
      3,
    )
    expect((blob.revShare as Record<string, unknown>).totalPmpe).toBe(20)
    expect((blob.values as Record<string, unknown>).bondRiskFeeSol).toBe(0)
    expect(blob.auctions).toEqual([{ bidPmpe: 1, effParticipatingBidPmpe: 1 }])
  })

  it('drops the recursive lastCapConstraint.validators back-reference', () => {
    const cap: Record<string, unknown> = {
      constraintType: 'BOND',
      constraintName: 'c',
      totalStakeSol: 1,
      totalLeftToCapSol: 0,
      marinadeStakeSol: 1,
      marinadeLeftToCapSol: 0,
      validators: [] as unknown[],
    }
    const v = calcValidator({ lastCapConstraint: cap })
    // Real auction shape: the constraint lists validators, each pointing back at
    // the same constraint — a genuine cycle. JSON.stringify would throw if kept.
    ;(cap.validators as unknown[]).push(v)

    const blob = toCalcValidator(v)
    const outCap = blob.lastCapConstraint as Record<string, unknown>
    expect(outCap).not.toHaveProperty('validators')
    expect(outCap.constraintType).toBe('BOND')
    expect(outCap.totalLeftToCapSol).toBe(0)
    expect(() => JSON.stringify(blob)).not.toThrow()
  })

  it('sanitizes NaN aggregate fields (ineligible validators) to null', () => {
    const blob = toCalcValidator(
      calcValidator({
        minBondPmpe: NaN,
        idealBondPmpe: Infinity,
        revShare: { totalPmpe: NaN, expectedMaxEffBidPmpe: 3.2 },
      }),
    )
    expect(blob.minBondPmpe).toBeNull()
    expect(blob.idealBondPmpe).toBeNull()
    expect((blob.revShare as Record<string, unknown>).totalPmpe).toBeNull()
    expect(() => JSON.stringify(blob)).not.toThrow()
  })
})
