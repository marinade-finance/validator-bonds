import { sleep, type LoggerWrapper } from '@marinade.finance/ts-common'

import type { PostResult, SendConfig } from './types'

const MAX_ERROR_LENGTH = 1000

export async function postEvent(
  message: { messageId: string; createdAtMs: number; payload: object },
  config: SendConfig,
  logger: LoggerWrapper,
): Promise<PostResult> {
  const url = `${config.notificationsApiUrl}/bonds-event-v1`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (config.notificationsJwt) {
    headers['Authorization'] = `Bearer ${config.notificationsJwt}`
  }

  const body = JSON.stringify({
    header: {
      producer_id: 'bonds-eventing',
      message_id: message.messageId,
      created_at: message.createdAtMs,
    },
    payload: message.payload,
  })

  let lastError = ''
  for (let attempt = 0; attempt <= config.retryMaxAttempts; attempt++) {
    if (attempt > 0) {
      const delay = config.retryBaseDelayMs * Math.pow(2, attempt - 1)
      logger.warn(
        `Retry attempt ${attempt}/${config.retryMaxAttempts} after ${delay}ms for message ${message.messageId}`,
      )
      await sleep(delay)
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(30_000),
      })

      if (response.ok) {
        return { kind: 'sent' }
      }

      const responseBody = await response.text().catch(() => 'no body')
      lastError = `HTTP ${response.status}: ${responseBody}`.slice(
        0,
        MAX_ERROR_LENGTH,
      )

      if (response.status === 400 || response.status === 422) {
        return { kind: 'rejected', error: lastError }
      }
      if (response.status === 401 || response.status === 403) {
        return { kind: 'unauthorized', error: lastError }
      }
    } catch (err) {
      lastError = (err instanceof Error ? err.message : String(err)).slice(
        0,
        MAX_ERROR_LENGTH,
      )
    }
  }

  logger.warn(`Retry exhausted for message ${message.messageId}: ${lastError}`)
  return { kind: 'retryable', error: lastError }
}
