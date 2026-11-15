import { parseSendConfig } from '../src/config'

const BASE_CONFIG = {
  notificationsApiUrl: 'https://example.com',
  notificationsJwt: undefined,
  postgresUrl: 'postgresql://localhost/test',
  postgresSslRootCert: undefined,
  retryMaxAttempts: 4,
  retryBaseDelayMs: 30000,
  dryRun: false,
}

describe('parseSendConfig numeric fields', () => {
  it('parses valid numbers', () => {
    const config = parseSendConfig({
      ...BASE_CONFIG,
      retryMaxAttempts: 3,
      retryBaseDelayMs: 5000,
    })
    expect(config.retryMaxAttempts).toBe(3)
    expect(config.retryBaseDelayMs).toBe(5000)
  })

  it('parses string numbers (from env vars)', () => {
    const config = parseSendConfig({
      ...BASE_CONFIG,
      retryMaxAttempts: '0',
      retryBaseDelayMs: '1000',
    })
    expect(config.retryMaxAttempts).toBe(0)
    expect(config.retryBaseDelayMs).toBe(1000)
  })

  it('falls back to defaults for undefined values', () => {
    const config = parseSendConfig({
      ...BASE_CONFIG,
      retryMaxAttempts: undefined,
      retryBaseDelayMs: undefined,
    })
    expect(config.retryMaxAttempts).toBe(4)
    expect(config.retryBaseDelayMs).toBe(30000)
  })

  it('falls back to defaults for empty strings (unset env vars)', () => {
    const config = parseSendConfig({
      ...BASE_CONFIG,
      retryMaxAttempts: '',
      retryBaseDelayMs: '',
    })
    expect(config.retryMaxAttempts).toBe(4)
    expect(config.retryBaseDelayMs).toBe(30000)
  })

  it('throws on NaN-producing values', () => {
    expect(() =>
      parseSendConfig({ ...BASE_CONFIG, retryMaxAttempts: 'abc' }),
    ).toThrow("Invalid value for --retry-max-attempts: 'abc'")

    expect(() =>
      parseSendConfig({ ...BASE_CONFIG, retryBaseDelayMs: NaN }),
    ).toThrow('Invalid value for --retry-base-delay-ms')
  })

  it('throws on negative values', () => {
    expect(() =>
      parseSendConfig({ ...BASE_CONFIG, retryMaxAttempts: -1 }),
    ).toThrow("Invalid value for --retry-max-attempts: '-1'")

    expect(() =>
      parseSendConfig({ ...BASE_CONFIG, retryBaseDelayMs: -100 }),
    ).toThrow("Invalid value for --retry-base-delay-ms: '-100'")
  })

  it('allows retryMaxAttempts 0 (no retries)', () => {
    const config = parseSendConfig({ ...BASE_CONFIG, retryMaxAttempts: 0 })
    expect(config.retryMaxAttempts).toBe(0)
  })

  it('floors fractional values', () => {
    const config = parseSendConfig({
      ...BASE_CONFIG,
      retryMaxAttempts: 2.9,
      retryBaseDelayMs: 10.7,
    })
    expect(config.retryMaxAttempts).toBe(2)
    expect(config.retryBaseDelayMs).toBe(10)
  })
})

describe('parseSendConfig required options', () => {
  it('throws without a postgres URL', () => {
    expect(() =>
      parseSendConfig({ ...BASE_CONFIG, postgresUrl: undefined }),
    ).toThrow('send requires --postgres-url')
  })

  it('throws without a notifications URL', () => {
    expect(() =>
      parseSendConfig({ ...BASE_CONFIG, notificationsApiUrl: undefined }),
    ).toThrow('send requires --notifications-api-url')
  })

  it('allows a missing notifications URL in dry run', () => {
    const config = parseSendConfig({
      ...BASE_CONFIG,
      notificationsApiUrl: undefined,
      dryRun: true,
    })
    expect(config.dryRun).toBe(true)
    expect(config.notificationsApiUrl).toBeUndefined()
  })
})
