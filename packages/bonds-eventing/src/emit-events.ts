import crypto from 'crypto'

import { sleep, type LoggerWrapper } from '@marinade.finance/ts-common'

import type { BondsEventV1, EmitResult, EventingConfig } from './types'

async function postEvent(
  event: BondsEventV1,
  config: EventingConfig,
  logger: LoggerWrapper,
): Promise<EmitResult> {
  const url = `${config.notificationsApiUrl}/bonds-event-v1`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (config.notificationsJwt) {
    headers['Authorization'] = `Bearer ${config.notificationsJwt}`
  }

  // Wrap event in the standard Message<T> envelope expected by
  // marinade-notifications ingress (header + payload pattern)
  const messageId = crypto.randomUUID()
  const message = {
    header: {
      producer_id: 'bonds-eventing',
      message_id: messageId,
      created_at: Date.now(),
    },
    payload: event,
  }

  let lastError: string | undefined
  for (let attempt = 0; attempt <= config.retryMaxAttempts; attempt++) {
    if (attempt > 0) {
      const delay = config.retryBaseDelayMs * Math.pow(2, attempt - 1)
      logger.warn(
        `Retry attempt ${attempt}/${config.retryMaxAttempts} after ${delay}ms for ${event.inner_type} event (${event.vote_account})`,
      )
      await sleep(delay)
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(30_000),
      })

      if (response.ok) {
        return { status: 'sent', messageId }
      }

      lastError = `HTTP ${response.status}: ${await response.text().catch(() => 'no body')}`

      // Don't retry on 4xx (client errors) except 429
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429
      ) {
        logger.warn(
          `Non-retryable error for ${event.inner_type} event (${event.vote_account}): ${lastError}`,
        )
        return { status: 'failed', messageId, error: lastError }
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
  }

  logger.warn(
    `Retry exhausted for ${event.inner_type} event (${event.vote_account}): ${lastError}`,
  )
  return { status: 'failed', messageId, error: lastError }
}

export async function emitEvents(
  events: BondsEventV1[],
  config: EventingConfig,
  logger: LoggerWrapper,
): Promise<Map<BondsEventV1, EmitResult>> {
  const results = new Map<BondsEventV1, EmitResult>()

  if (events.length === 0) {
    logger.info('No events to emit')
    return results
  }

  if (config.dryRun) {
    logger.info(`[DRY RUN] Would emit ${events.length} events:`)
    for (const event of events) {
      logger.info(
        { event },
        `[DRY RUN] ${event.inner_type} for ${event.vote_account}`,
      )
      results.set(event, { status: 'sent', messageId: 'dry-run' })
    }
    return results
  }

  if (!config.notificationsApiUrl) {
    logger.warn(
      'No notifications API URL configured, marking all events as failed',
    )
    for (const event of events) {
      results.set(event, {
        status: 'failed',
        messageId: crypto.randomUUID(),
        error: 'No notifications API URL configured',
      })
    }
    return results
  }

  const concurrency = config.emitConcurrency
  logger.info(
    `Emitting ${events.length} events with concurrency ${concurrency}`,
  )

  // Pool: keep `concurrency` POST requests in flight at all times
  const queue = [...events]
  let inFlight = 0

  await new Promise<void>(resolve => {
    function next() {
      while (inFlight < concurrency && queue.length > 0) {
        const event = queue.shift()
        if (!event) break
        inFlight++
        void postEvent(event, config, logger).then(result => {
          results.set(event, result)
          inFlight--
          if (queue.length === 0 && inFlight === 0) {
            resolve()
          } else {
            next()
          }
        })
      }
      if (queue.length === 0 && inFlight === 0) {
        resolve()
      }
    }
    next()
  })

  const sent = [...results.values()].filter(r => r.status === 'sent').length
  const failed = [...results.values()].filter(r => r.status === 'failed').length
  logger.info(`Emitted ${sent} events successfully, ${failed} failed`)

  return results
}
