import {
  makeNotificationId,
  computeAmountBucket,
  computeTimeBucket,
} from '../src/notification-id'

describe('makeNotificationId', () => {
  const voteAccount = 'TestVoteAccount1111111111111111111111111111'

  it('same inputs produce same ID (deterministic)', () => {
    const id1 = makeNotificationId(
      voteAccount,
      'underfunded',
      '11',
      '2025-01-15T12:00:00.000Z',
      24,
    )
    const id2 = makeNotificationId(
      voteAccount,
      'underfunded',
      '11',
      '2025-01-15T12:00:00.000Z',
      24,
    )
    expect(id1).toBe(id2)
  })

  it('different time bucket (24h later) produces different ID', () => {
    const id1 = makeNotificationId(
      voteAccount,
      'underfunded',
      '11',
      '2025-01-15T12:00:00.000Z',
      24,
    )
    const id2 = makeNotificationId(
      voteAccount,
      'underfunded',
      '11',
      '2025-01-16T13:00:00.000Z', // 25h later — different 24h bucket
      24,
    )
    expect(id1).not.toBe(id2)
  })

  it('different amount bucket produces different ID', () => {
    const id1 = makeNotificationId(
      voteAccount,
      'underfunded',
      '11',
      '2025-01-15T12:00:00.000Z',
      24,
    )
    const id2 = makeNotificationId(
      voteAccount,
      'underfunded',
      '12',
      '2025-01-15T12:00:00.000Z',
      24,
    )
    expect(id1).not.toBe(id2)
  })

  it('same time within same bucket produces same ID', () => {
    const id1 = makeNotificationId(
      voteAccount,
      'underfunded',
      '11',
      '2025-01-15T12:00:00.000Z',
      24,
    )
    const id2 = makeNotificationId(
      voteAccount,
      'underfunded',
      '11',
      '2025-01-15T18:00:00.000Z', // 6h later — same 24h bucket
      24,
    )
    expect(id1).toBe(id2)
  })
})

describe('computeAmountBucket', () => {
  it('returns 0 for zero or negative values', () => {
    expect(computeAmountBucket(0, 20)).toBe(0)
    expect(computeAmountBucket(-1, 20)).toBe(0)
  })

  it('8.5 SOL and 8.6 SOL are in the same bucket (pct=20)', () => {
    const bucket1 = computeAmountBucket(8.5, 20)
    const bucket2 = computeAmountBucket(8.6, 20)
    expect(bucket1).toBe(bucket2)
  })

  it('8.5 SOL and 10.5 SOL are in different buckets (pct=20)', () => {
    const bucket1 = computeAmountBucket(8.5, 20)
    const bucket2 = computeAmountBucket(10.5, 20)
    expect(bucket1).not.toBe(bucket2)
  })

  it('increasing values produce increasing bucket numbers', () => {
    const b1 = computeAmountBucket(1, 20)
    const b2 = computeAmountBucket(5, 20)
    const b3 = computeAmountBucket(20, 20)
    expect(b2).toBeGreaterThan(b1)
    expect(b3).toBeGreaterThan(b2)
  })
})

describe('computeTimeBucket', () => {
  it('events in the same 24h window have the same bucket', () => {
    const b1 = computeTimeBucket('2025-01-15T01:00:00.000Z', 24)
    const b2 = computeTimeBucket('2025-01-15T23:00:00.000Z', 24)
    expect(b1).toBe(b2)
  })

  it('events at day boundary cross to different buckets', () => {
    // The 24h bucket boundary is at multiples of 24h from epoch
    // 2025-01-15T00:00:00Z = 1736899200000ms, bucket = floor(1736899200000 / 86400000) = 20104
    // 2025-01-16T00:00:00Z = 1736985600000ms, bucket = floor(1736985600000 / 86400000) = 20105
    const b1 = computeTimeBucket('2025-01-15T23:59:00.000Z', 24)
    const b2 = computeTimeBucket('2025-01-16T00:01:00.000Z', 24)
    expect(b1).not.toBe(b2)
  })
})
