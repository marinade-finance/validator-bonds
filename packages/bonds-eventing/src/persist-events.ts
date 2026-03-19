import { type DatabasePool, sql } from 'slonik'

import type { BondsEventV1, EmitResult } from './types'
import type { LoggerWrapper } from '@marinade.finance/ts-common'

export async function persistEvents(
  pool: DatabasePool,
  results: Map<BondsEventV1, EmitResult>,
  logger: LoggerWrapper,
): Promise<void> {
  if (results.size === 0) {
    return
  }

  for (const [event, result] of results) {
    await pool.query(sql.unsafe`
      INSERT INTO emitted_bond_events (
        message_id, inner_type, vote_account, bond_pubkey,
        epoch, payload, status, error, created_at
      ) VALUES (
        ${crypto.randomUUID()},
        ${event.inner_type},
        ${event.vote_account},
        ${event.bond_pubkey},
        ${event.epoch},
        ${JSON.stringify(event)}::jsonb,
        ${result.status},
        ${result.error ?? null},
        NOW()
      )
    `)
  }

  logger.info(`Persisted ${results.size} event records`)
}
