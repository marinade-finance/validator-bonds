import { raceWithTimeout } from '../src/async'

describe('raceWithTimeout', () => {
  it('returns the operation result when it settles before the timeout', async () => {
    const result = await raceWithTimeout(Promise.resolve(42), 1000, -1)
    expect(result).toBe(42)
  })

  it('returns the fallback when the timeout wins', async () => {
    const slow = new Promise<number>(resolve => {
      const t = setTimeout(() => resolve(42), 1000)
      t.unref()
    })
    const result = await raceWithTimeout(slow, 10, -1)
    expect(result).toBe(-1)
  })

  it('returns the fallback when the operation rejects', async () => {
    const result = await raceWithTimeout(
      Promise.reject(new Error('boom')),
      1000,
      -1,
    )
    expect(result).toBe(-1)
  })
})
