import { sanitizeJson } from '../src/persist-events'

describe('sanitizeJson', () => {
  it('replaces NaN with null', () => {
    expect(sanitizeJson(NaN)).toBeNull()
  })

  it('replaces ±Infinity with null', () => {
    expect(sanitizeJson(Infinity)).toBeNull()
    expect(sanitizeJson(-Infinity)).toBeNull()
  })

  it('passes finite numbers through', () => {
    expect(sanitizeJson(0)).toBe(0)
    expect(sanitizeJson(-1.5)).toBe(-1.5)
    expect(sanitizeJson(1e20)).toBe(1e20)
  })

  it('preserves non-number primitives and null', () => {
    expect(sanitizeJson(null)).toBeNull()
    expect(sanitizeJson(undefined)).toBeUndefined()
    expect(sanitizeJson('x')).toBe('x')
    expect(sanitizeJson(true)).toBe(true)
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
    expect(sanitizeJson(event)).toEqual({
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

  it('stores what the emitted payload serializes to', () => {
    const raw = { a: NaN, b: [Infinity, { c: NaN }] }
    expect(JSON.stringify(sanitizeJson(raw))).toBe(JSON.stringify(raw))
    expect(JSON.stringify(sanitizeJson(raw))).toBe(
      '{"a":null,"b":[null,{"c":null}]}',
    )
  })
})
