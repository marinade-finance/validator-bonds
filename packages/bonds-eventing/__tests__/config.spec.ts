import { parseConfig } from '../src/config'

const BASE_CONFIG = {
  bondsApiUrl: 'https://example.com',
  validatorsApiUrl: 'https://example.com',
  scoringApiUrl: 'https://example.com',
  tvlApiUrl: 'https://example.com',
  notificationsApiUrl: undefined,
  notificationsJwt: undefined,
  postgresUrl: undefined,
  postgresSslRootCert: undefined,
  retryMaxAttempts: 4,
  retryBaseDelayMs: 30000,
  emitConcurrency: 20,
  dryRun: false,
  cacheInputs: undefined,
}

describe('parseConfig numeric fields', () => {
  it('parses valid numbers', () => {
    const config = parseConfig({
      ...BASE_CONFIG,
      retryMaxAttempts: 3,
      retryBaseDelayMs: 5000,
      emitConcurrency: 100,
    })
    expect(config.retryMaxAttempts).toBe(3)
    expect(config.retryBaseDelayMs).toBe(5000)
    expect(config.emitConcurrency).toBe(100)
  })

  it('parses string numbers (from env vars)', () => {
    const config = parseConfig({
      ...BASE_CONFIG,
      retryMaxAttempts: '0',
      retryBaseDelayMs: '1000',
      emitConcurrency: '50',
    })
    expect(config.retryMaxAttempts).toBe(0)
    expect(config.retryBaseDelayMs).toBe(1000)
    expect(config.emitConcurrency).toBe(50)
  })

  it('falls back to defaults for undefined values', () => {
    const config = parseConfig({
      ...BASE_CONFIG,
      retryMaxAttempts: undefined,
      retryBaseDelayMs: undefined,
      emitConcurrency: undefined,
    })
    expect(config.retryMaxAttempts).toBe(4)
    expect(config.retryBaseDelayMs).toBe(30000)
    expect(config.emitConcurrency).toBe(20)
  })

  it('falls back to defaults for empty strings (unset env vars)', () => {
    const config = parseConfig({
      ...BASE_CONFIG,
      retryMaxAttempts: '',
      retryBaseDelayMs: '',
      emitConcurrency: '',
    })
    expect(config.retryMaxAttempts).toBe(4)
    expect(config.retryBaseDelayMs).toBe(30000)
    expect(config.emitConcurrency).toBe(20)
  })

  it('throws on NaN-producing values', () => {
    expect(() =>
      parseConfig({ ...BASE_CONFIG, retryMaxAttempts: 'abc' }),
    ).toThrow("Invalid value for --retry-max-attempts: 'abc'")

    expect(() =>
      parseConfig({ ...BASE_CONFIG, retryBaseDelayMs: NaN }),
    ).toThrow('Invalid value for --retry-base-delay-ms')

    expect(() =>
      parseConfig({ ...BASE_CONFIG, emitConcurrency: 'not-a-number' }),
    ).toThrow("Invalid value for --emit-concurrency: 'not-a-number'")
  })

  it('throws on negative values', () => {
    expect(() => parseConfig({ ...BASE_CONFIG, retryMaxAttempts: -1 })).toThrow(
      "Invalid value for --retry-max-attempts: '-1'",
    )

    expect(() =>
      parseConfig({ ...BASE_CONFIG, retryBaseDelayMs: -100 }),
    ).toThrow("Invalid value for --retry-base-delay-ms: '-100'")

    expect(() => parseConfig({ ...BASE_CONFIG, emitConcurrency: -5 })).toThrow(
      "Invalid value for --emit-concurrency: '-5'",
    )
  })

  it('throws when emitConcurrency is 0', () => {
    expect(() => parseConfig({ ...BASE_CONFIG, emitConcurrency: 0 })).toThrow(
      "Invalid value for --emit-concurrency: '0'",
    )
  })

  it('allows retryMaxAttempts 0 (no retries)', () => {
    const config = parseConfig({ ...BASE_CONFIG, retryMaxAttempts: 0 })
    expect(config.retryMaxAttempts).toBe(0)
  })

  it('floors fractional values', () => {
    const config = parseConfig({
      ...BASE_CONFIG,
      emitConcurrency: 10.7,
      retryMaxAttempts: 2.9,
    })
    expect(config.emitConcurrency).toBe(10)
    expect(config.retryMaxAttempts).toBe(2)
  })
})
