import { type DatabasePool, sql } from 'slonik'

import type { BondsEventV1, EmitResult } from './types'
import type { LoggerWrapper } from '@marinade.finance/ts-common'
import type { SerializableValue } from 'slonik'

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
      ${sql.jsonb(event as unknown as SerializableValue)},
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
  `)

  logger.info(`Persisted ${results.size} event records`)
}
