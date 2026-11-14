import { type CommonQueryMethods, sql, type SerializableValue } from 'slonik'
import { v7 as uuidv7 } from 'uuid'

import type { BondType, BondsEventV1, PendingEvent, PostResult } from './types'
import type { LoggerWrapper } from '@marinade.finance/ts-common'

// slonik's strict `sql.jsonb` throws on NaN / ±Infinity, which `JSON.stringify` would map to null.
export function sanitizeForJsonb(value: unknown): unknown {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeForJsonb)
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = sanitizeForJsonb(v)
  }
  return out
}

export async function insertPendingEvents(
  db: CommonQueryMethods,
  events: BondsEventV1[],
  logger: LoggerWrapper,
): Promise<void> {
  if (events.length === 0) {
    return
  }

  const valueTuples = events.map(
    event => sql.fragment`(
      ${uuidv7()},
      ${event.inner_type},
      ${event.vote_account},
      ${event.bond_pubkey},
      ${event.bond_type},
      ${event.epoch},
      ${sql.jsonb(sanitizeForJsonb(event) as SerializableValue)},
      'pending',
      NOW()
    )`,
  )

  await db.query(sql.unsafe`
    INSERT INTO emitted_bond_events (
      message_id, inner_type, vote_account, bond_pubkey,
      bond_type, epoch, payload, status, created_at
    ) VALUES ${sql.join(valueTuples, sql.fragment`, `)}
  `)

  logger.info(`Stored ${events.length} pending events`)
}

export const MAX_SEND_ATTEMPTS = 10

export async function loadPendingEvents(
  db: CommonQueryMethods,
  bondType: BondType,
): Promise<PendingEvent[]> {
  const result = await db.query(sql.unsafe`
    SELECT e.id, e.message_id, e.payload, e.attempts,
      EXISTS (
        SELECT 1 FROM emitted_bond_events n
        WHERE n.bond_type = e.bond_type
          AND n.vote_account = e.vote_account
          AND n.inner_type = e.inner_type
          AND n.status = 'pending'
          AND n.id > e.id
      ) superseded
    FROM emitted_bond_events e
    WHERE e.bond_type = ${bondType} AND e.status = 'pending'
    ORDER BY e.id
  `)
  return (
    result.rows as unknown as {
      id: number
      message_id: string
      payload: BondsEventV1
      attempts: number
      superseded: boolean
    }[]
  ).map(row => ({
    id: row.id,
    messageId: row.message_id,
    payload: row.payload,
    attempts: row.attempts,
    supersededByNewer: row.superseded,
  }))
}

export async function markEvent(
  db: CommonQueryMethods,
  id: number,
  result: PostResult,
): Promise<void> {
  switch (result.kind) {
    case 'sent':
      await db.query(sql.unsafe`
        UPDATE emitted_bond_events
        SET status = 'sent', last_error = NULL, last_attempt_at = NOW()
        WHERE id = ${id}
      `)
      return
    case 'rejected':
      await db.query(sql.unsafe`
        UPDATE emitted_bond_events
        SET status = 'rejected', last_error = ${result.error},
          last_attempt_at = NOW()
        WHERE id = ${id}
      `)
      return
    case 'unauthorized':
      await db.query(sql.unsafe`
        UPDATE emitted_bond_events
        SET last_error = ${result.error}, last_attempt_at = NOW()
        WHERE id = ${id}
      `)
      return
    case 'retryable':
      await db.query(sql.unsafe`
        UPDATE emitted_bond_events
        SET attempts = attempts + 1,
          status = CASE WHEN attempts + 1 >= ${MAX_SEND_ATTEMPTS}
            THEN 'failed' ELSE 'pending' END,
          last_error = ${result.error}, last_attempt_at = NOW()
        WHERE id = ${id}
      `)
      return
  }
}
