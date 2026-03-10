import type { EventingConfig } from './types'

/** Parse a value as integer >= 0. Returns fallback for undefined/empty (unset env var). Throws on invalid input. */
function parseNonNegativeInt(
  name: string,
  value: unknown,
  fallback: number,
): number {
  if (value === undefined || value === null || value === '') return fallback
  const n = Number(value)
  const repr = typeof value === 'string' ? value : `${n}`
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(
      `Invalid value for ${name}: '${repr}' (expected non-negative integer)`,
    )
  }
  return Math.floor(n)
}

/** Parse a value as integer >= 1. Returns fallback for undefined/empty (unset env var). Throws on invalid input. */
function parsePositiveInt(
  name: string,
  value: unknown,
  fallback: number,
): number {
  if (value === undefined || value === null || value === '') return fallback
  const n = Number(value)
  const repr = typeof value === 'string' ? value : `${n}`
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(
      `Invalid value for ${name}: '${repr}' (expected positive integer)`,
    )
  }
  return Math.floor(n)
}

export function parseConfig(opts: Record<string, unknown>): EventingConfig {
  return {
    bondsApiUrl: opts.bondsApiUrl as string,
    validatorsApiUrl: opts.validatorsApiUrl as string,
    scoringApiUrl: opts.scoringApiUrl as string,
    tvlApiUrl: opts.tvlApiUrl as string,
    notificationsApiUrl: opts.notificationsApiUrl as string | undefined,
    notificationsJwt: opts.notificationsJwt as string | undefined,
    postgresUrl: opts.postgresUrl as string | undefined,
    postgresSslRootCert: opts.postgresSslRootCert as string | undefined,
    retryMaxAttempts: parseNonNegativeInt(
      '--retry-max-attempts',
      opts.retryMaxAttempts,
      4,
    ),
    retryBaseDelayMs: parseNonNegativeInt(
      '--retry-base-delay-ms',
      opts.retryBaseDelayMs,
      30000,
    ),
    emitConcurrency: parsePositiveInt(
      '--emit-concurrency',
      opts.emitConcurrency,
      20,
    ),
    dryRun: opts.dryRun as boolean,
    cacheInputs: opts.cacheInputs as string | undefined,
  }
}
