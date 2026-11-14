import type { EventingConfig, SendConfig } from './types'
import type { LoggerWrapper } from '@marinade.finance/ts-common'

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

function parseDryRun(value: unknown): boolean {
  return value === true || value === 'true'
}

export function parseConfig(opts: Record<string, unknown>): EventingConfig {
  return {
    bondsApiUrl: opts.bondsApiUrl as string,
    validatorsApiUrl: opts.validatorsApiUrl as string,
    scoringApiUrl: opts.scoringApiUrl as string,
    tvlApiUrl: opts.tvlApiUrl as string,
    institutionalApiUrl: opts.institutionalApiUrl as string,
    postgresUrl: opts.postgresUrl as string | undefined,
    postgresSslRootCert: opts.postgresSslRootCert as string | undefined,
    dryRun: parseDryRun(opts.dryRun),
    cacheInputs: opts.cacheInputs as string | undefined,
  }
}

export function parseSendConfig(opts: Record<string, unknown>): SendConfig {
  const postgresUrl = opts.postgresUrl as string | undefined
  const notificationsApiUrl = opts.notificationsApiUrl as string | undefined
  const dryRun = parseDryRun(opts.dryRun)
  if (!postgresUrl) {
    throw new Error('send requires --postgres-url')
  }
  if (!notificationsApiUrl && !dryRun) {
    throw new Error('send requires --notifications-api-url')
  }
  return {
    notificationsApiUrl,
    notificationsJwt: opts.notificationsJwt as string | undefined,
    postgresUrl,
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
    dryRun,
  }
}

export function logResolvedConfig(
  logger: LoggerWrapper,
  config: EventingConfig | SendConfig,
) {
  logger.info(
    {
      ...config,
      ...('notificationsJwt' in config && {
        notificationsJwt: config.notificationsJwt ? '***' : undefined,
      }),
      postgresUrl: config.postgresUrl ? '***' : undefined,
    },
    'Resolved configuration',
  )
}
