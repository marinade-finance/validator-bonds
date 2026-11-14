import * as fs from 'fs'

import { postEvent } from './emit-events'
import { UndeliveredEventsError } from './exit-code'
import { MAX_SEND_ATTEMPTS } from './persist-events'

import type {
  BondType,
  PendingEvent,
  PostResult,
  SendConfig,
  SendSummary,
} from './types'
import type { LoggerWrapper } from '@marinade.finance/ts-common'

export async function sendPendingEvents(
  rows: PendingEvent[],
  mark: (id: number, result: PostResult) => Promise<void>,
  config: SendConfig,
  logger: LoggerWrapper,
): Promise<SendSummary> {
  const summary: SendSummary = {
    sent: 0,
    rejected: 0,
    failed: 0,
    remaining: rows.length,
    stoppedBy: null,
    lastError: null,
  }

  if (config.dryRun) {
    for (const row of rows) {
      logger.info(
        {
          message_id: row.messageId,
          inner_type: row.payload.inner_type,
          vote_account: row.payload.vote_account,
          superseded_by_newer: row.supersededByNewer,
        },
        '[DRY RUN] Would send pending event',
      )
    }
    return summary
  }

  for (const row of rows) {
    const result = await postEvent(
      {
        messageId: row.messageId,
        createdAtMs: Date.parse(row.payload.created_at),
        payload: row.supersededByNewer
          ? { ...row.payload, superseded_by_newer: true }
          : row.payload,
      },
      config,
      logger,
    )
    await mark(row.id, result)

    if (result.kind === 'sent') {
      summary.sent++
      summary.remaining--
      continue
    }
    summary.lastError = result.error
    if (result.kind === 'rejected') {
      summary.rejected++
      summary.remaining--
      continue
    }
    if (result.kind === 'retryable' && row.attempts + 1 >= MAX_SEND_ATTEMPTS) {
      summary.failed++
      summary.remaining--
    }
    summary.stoppedBy = result.kind
    break
  }

  return summary
}

export function isUndelivered(summary: SendSummary): boolean {
  return (
    summary.stoppedBy !== null ||
    summary.rejected > 0 ||
    summary.failed > 0 ||
    summary.remaining > 0
  )
}

export function formatSendSummary(
  bondType: string,
  summary: SendSummary,
): string {
  const lines = [
    `### Bond events not fully delivered (${bondType})`,
    '',
    `- sent: ${summary.sent}`,
    `- rejected: ${summary.rejected}`,
    `- failed: ${summary.failed}`,
    `- still pending: ${summary.remaining}`,
    `- stopped by: ${summary.stoppedBy ?? 'none'}`,
  ]
  if (summary.lastError !== null) {
    lines.push('', 'Last error:', '```', summary.lastError, '```')
  }
  return lines.join('\n') + '\n'
}

/** Writes the summary file and throws UndeliveredEventsError when a non-dry run left events undelivered. */
export function reportUndelivered(
  bondType: BondType,
  summary: SendSummary,
  config: SendConfig,
): void {
  if (config.dryRun || !isUndelivered(summary)) {
    return
  }
  if (config.summaryFile) {
    fs.writeFileSync(config.summaryFile, formatSendSummary(bondType, summary))
  }
  throw new UndeliveredEventsError(
    `${bondType} events not fully delivered: sent ${summary.sent}, rejected ${summary.rejected}, failed ${summary.failed}, pending ${summary.remaining}`,
  )
}
