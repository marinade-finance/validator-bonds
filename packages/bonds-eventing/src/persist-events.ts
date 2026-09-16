import type { Directory } from './directory'
import type { BondType, BondsEventV1, EmitResult } from './types'
import type { LoggerWrapper } from '@marinade.finance/ts-common'

/** One emitted event as it is stored, mirroring the envelope the notifications API received. */
interface EmittedEvent {
  message_id: string
  inner_type: BondsEventV1['inner_type']
  vote_account: BondsEventV1['vote_account']
  bond_pubkey: BondsEventV1['bond_pubkey']
  bond_type: BondType
  epoch: number
  payload: unknown
  status: EmitResult['status']
  error: string | null
  created_at: string
}

// NaN and ±Infinity are not JSON. `JSON.stringify` maps them to null on its own,
// so this makes the stored payload equal to the one the emit step POSTed and
// keeps that mapping under test.
export function sanitizeJson(value: unknown): unknown {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeJson)
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = sanitizeJson(v)
  }
  return out
}

export async function persistEvents(
  dir: Directory,
  results: Map<BondsEventV1, EmitResult>,
  logger: LoggerWrapper,
): Promise<void> {
  if (results.size === 0) {
    return
  }

  const createdAt = new Date().toISOString()
  for (const [event, result] of results) {
    const record: EmittedEvent = {
      message_id: result.messageId,
      inner_type: event.inner_type,
      vote_account: event.vote_account,
      bond_pubkey: event.bond_pubkey,
      bond_type: event.bond_type,
      epoch: event.epoch,
      payload: sanitizeJson(event),
      status: result.status,
      error: result.error ?? null,
      created_at: createdAt,
    }
    const path = `/bonds/events/${event.bond_type}/${event.epoch}/${result.messageId}`

    // The path carries a message id minted for this POST, so a refusal is a
    // uuidv7 collision rather than a replay of something already stored.
    await dir.put(path, record, { create: true })
  }

  logger.info(`Persisted ${results.size} event records`)
}
