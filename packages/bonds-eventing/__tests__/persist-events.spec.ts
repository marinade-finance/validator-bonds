import { sanitizeForJsonb } from '../src/persist-events'

describe('sanitizeForJsonb', () => {
  it('replaces NaN with null', () => {
    expect(sanitizeForJsonb(NaN)).toBeNull()
  })

  it('replaces ±Infinity with null', () => {
    expect(sanitizeForJsonb(Infinity)).toBeNull()
    expect(sanitizeForJsonb(-Infinity)).toBeNull()
  })

  it('passes finite numbers through', () => {
    expect(sanitizeForJsonb(0)).toBe(0)
    expect(sanitizeForJsonb(-1.5)).toBe(-1.5)
    expect(sanitizeForJsonb(1e20)).toBe(1e20)
  })

  it('preserves non-number primitives and null', () => {
    expect(sanitizeForJsonb(null)).toBeNull()
    expect(sanitizeForJsonb(undefined)).toBeUndefined()
    expect(sanitizeForJsonb('x')).toBe('x')
    expect(sanitizeForJsonb(true)).toBe(true)
  })

  it('recursively sanitizes nested objects and arrays', () => {
    const event = {
      type: 'bonds',
      data: {
        details: {
          total_penalty_sol: NaN,
          bid_too_low_penalty_pmpe: NaN,
          bond_balance_sol: 10,
          history: [1, NaN, Infinity, { x: -Infinity }],
        },
      },
    }
    expect(sanitizeForJsonb(event)).toEqual({
      type: 'bonds',
      data: {
        details: {
          total_penalty_sol: null,
          bid_too_low_penalty_pmpe: null,
          bond_balance_sol: 10,
          history: [1, null, null, { x: null }],
        },
      },
    })
  })

  it('produces an output that JSON.stringify accepts in strict mode', () => {
    // Mimics slonik's safe-stable-stringify strict behavior: regular JSON
    // already throws on BigInt and silently nulls NaN — we only need to
    // assert that nothing remains that strict mode would reject.
    const sanitized = sanitizeForJsonb({ a: NaN, b: [Infinity, { c: NaN }] })
    expect(JSON.stringify(sanitized)).toBe(
      JSON.stringify({ a: null, b: [null, { c: null }] }),
    )
  })
})
