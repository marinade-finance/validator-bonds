import type { Logger } from 'pino'

const CLI_USAGE_TIMEOUT_MS = 1500

export type CliType = 'sam' | 'institutional'

export interface CliUsageConfig {
  enabled: boolean
  cliType: CliType
}

export interface RecordCliUsageParams {
  apiUrl: string
  cliType: CliType
  cliVersion: string
  operation?: string
  account?: string
}

/**
 * Fire-and-forget POST to /v1/cli-usage. Resolves to void regardless of outcome;
 * callers should not await the returned promise for latency-sensitive paths.
 */
export async function recordCliUsage(
  params: RecordCliUsageParams,
  logger?: Logger,
): Promise<void> {
  try {
    const url = new URL('/v1/cli-usage', params.apiUrl)
    url.searchParams.set('type', params.cliType)
    url.searchParams.set('cli_version', params.cliVersion)
    if (params.operation) {
      url.searchParams.set('operation', params.operation)
    }
    if (params.account) {
      url.searchParams.set('account', params.account)
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), CLI_USAGE_TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
      })

      if (!response.ok) {
        logger?.debug(`CLI usage API returned status ${response.status}`)
      }
    } finally {
      clearTimeout(timeoutId)
    }
  } catch (error) {
    if (error instanceof Error) {
      logger?.debug(`CLI usage API error: ${error.message}`)
    }
  }
}
