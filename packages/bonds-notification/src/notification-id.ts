import { createHash } from 'crypto'

/**
 * Generate a deterministic notification ID for dedup.
 *
 * The ID changes when:
 * 1. The situation changes significantly (different magnitudeBucket)
 * 2. The re-notify interval elapses (different timeBucket)
 *
 * Same ID = dedup'd (already delivered). New ID = new delivery.
 */
export function makeNotificationId(
  voteAccount: string,
  category: string,
  magnitudeBucket: string,
  createdAtIso: string,
  renotifyIntervalHours: number,
): string {
  const timeBucket = computeTimeBucket(createdAtIso, renotifyIntervalHours)
  const input = `${voteAccount}:${category}:${magnitudeBucket}:${timeBucket}`
  return createHash('sha256').update(input).digest('hex')
}

/**
 * Time bucket: floor(timestamp / interval).
 * When the interval elapses, the bucket number increments,
 * producing a new notification_id -> bypasses dedup.
 */
export function computeTimeBucket(
  createdAtIso: string,
  intervalHours: number,
): number {
  const ms = new Date(createdAtIso).getTime()
  const intervalMs = intervalHours * 3600 * 1000
  return Math.floor(ms / intervalMs)
}

/**
 * Amount bucket using logarithmic scale.
 * Base = 1 + (pct / 100). Each bucket spans a ~pct% range.
 *
 * Example with pct=20:
 *   deficit 8.5 SOL -> bucket 11  (range ~7.4-8.9)
 *   deficit 11.0 SOL -> bucket 12  (range ~8.9-10.7)
 *   deficit 8.6 SOL -> bucket 11  (same -- <20% change, dedup'd)
 *
 * Edge case: values near bucket boundaries may cross on small changes.
 * This is acceptable -- the goal is approximate dedup, not exact thresholds.
 */
export function computeAmountBucket(
  value: number,
  significantChangePct: number,
): number {
  if (value <= 0) return 0
  const base = 1 + significantChangePct / 100
  return Math.floor(Math.log(value) / Math.log(base))
}
