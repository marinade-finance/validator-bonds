import { type CommonQueryMethods, sql, type SerializableValue } from 'slonik'
import { v7 as uuidv7 } from 'uuid'

import type { BondsEventV1 } from './types'
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
