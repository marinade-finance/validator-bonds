import { Command } from 'commander'

import { addSharedEventingOptions } from '../src/commands/options'
import { parseConfig } from '../src/config'

const BASE_CONFIG = {
  bondsApiUrl: 'https://example.com',
  validatorsApiUrl: 'https://example.com',
  scoringApiUrl: 'https://example.com',
  tvlApiUrl: 'https://example.com',
  notificationsApiUrl: undefined,
  notificationsJwt: undefined,
  directoryUrl: 'https://directory.test',
  directoryToken: 'test-token',
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

describe('--allow-empty-state', () => {
  /**
   * The pipeline's empty-state error tells the operator to pass this flag, so
   * the shared options must accept it and parseConfig must carry it through.
   */
  it('is accepted on the command line and reaches the config', () => {
    const command = addSharedEventingOptions(new Command()).exitOverride()
    command.parse(['--allow-empty-state'], { from: 'user' })
    const config = parseConfig({ ...BASE_CONFIG, ...command.opts() })
    expect(config.allowEmptyState).toBe(true)
  })
})

describe.each([
  ['EVENTING_ALLOW_EMPTY_STATE', 'allowEmptyState'],
  ['DRY_RUN', 'dryRun'],
] as const)('%s', (envVar, option) => {
  /** Boolean environment values reach the parsed config unchanged. */
  it.each([
    ['false', false],
    ['true', true],
    [undefined, false],
  ])('reads %s as %s', (value, expected) => {
    const previous = process.env[envVar]
    if (value === undefined) delete process.env[envVar]
    else process.env[envVar] = value
    try {
      const command = addSharedEventingOptions(new Command()).exitOverride()
      command.parse([], { from: 'user' })
      const config = parseConfig({ ...BASE_CONFIG, ...command.opts() })
      expect(config[option]).toBe(expected)
    } finally {
      if (previous === undefined) delete process.env[envVar]
      else process.env[envVar] = previous
    }
  })

  /** Invalid environment values stop the command. */
  it('refuses 0', () => {
    const previous = process.env[envVar]
    process.env[envVar] = '0'
    try {
      const command = addSharedEventingOptions(new Command()).exitOverride()
      command.configureOutput({ writeErr: () => undefined })
      expect(() => command.parse([], { from: 'user' })).toThrow(
        "expected true or false, got '0'",
      )
    } finally {
      if (previous === undefined) delete process.env[envVar]
      else process.env[envVar] = previous
    }
  })
})
