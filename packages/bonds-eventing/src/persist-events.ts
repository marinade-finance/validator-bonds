import { type DatabasePool, sql, type SerializableValue } from 'slonik'

import type { BondsEventV1, EmitResult } from './types'
import type { LoggerWrapper } from '@marinade.finance/ts-common'

// slonik's `sql.jsonb(...)` uses safe-stable-stringify in strict mode, which
// throws on NaN / ±Infinity. Native `JSON.stringify` (used by the emit step)
// silently maps them to null — this helper aligns the persisted payload with
// what the notifications API already receives.
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

export async function persistEvents(
  pool: DatabasePool,
  results: Map<BondsEventV1, EmitResult>,
  logger: LoggerWrapper,
): Promise<void> {
  if (results.size === 0) {
    return
  }

  const valueTuples = Array.from(
    results,
    ([event, result]) =>
      sql.fragment`(
      ${result.messageId},
      ${event.inner_type},
      ${event.vote_account},
      ${event.bond_pubkey},
      ${event.bond_type},
      ${event.epoch},
      ${sql.jsonb(sanitizeForJsonb(event) as SerializableValue)},
      ${result.status},
      ${result.error ?? null},
      NOW()
    )`,
  )

  await pool.query(sql.unsafe`
    INSERT INTO emitted_bond_events (
      message_id, inner_type, vote_account, bond_pubkey,
      bond_type, epoch, payload, status, error, created_at
    ) VALUES ${sql.join(valueTuples, sql.fragment`, `)}
    ON CONFLICT (message_id) DO NOTHING
  `)

  logger.info(`Persisted ${results.size} event records`)
}
