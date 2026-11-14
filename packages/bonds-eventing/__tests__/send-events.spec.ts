import http from 'http'

import pino from 'pino'

import { sendPendingEvents } from '../src/send-events'

import type {
  BondsEventV1,
  PendingEvent,
  PostResult,
  SendConfig,
} from '../src/types'

const logger = pino({ level: 'silent' })

function makeRow(
  id: number,
  overrides: Partial<PendingEvent> = {},
): PendingEvent {
  const payload: BondsEventV1 = {
    type: 'bonds',
    inner_type: 'bond_balance_change',
    vote_account: `vote${id}`,
    bond_pubkey: 'bond111',
    bond_type: 'bidding',
    epoch: 930,
    data: { message: 'Test message', details: {} },
    created_at: '2026-11-14T10:00:00.000Z',
  }
  return {
    id,
    messageId: `0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a${String(id).padStart(2, '0')}`,
    payload,
    attempts: 0,
    supersededByNewer: false,
    ...overrides,
  }
}

interface Received {
  messageId: string
  payload: Record<string, unknown>
}

async function withServer(
  statuses: number[],
  fn: (config: SendConfig, received: Received[]) => Promise<void>,
): Promise<void> {
  const received: Received[] = []
  let inFlight = 0
  let overlapped = false
  const server = http.createServer((req, res) => {
    inFlight++
    if (inFlight > 1) overlapped = true
    let body = ''
    req.on('data', chunk => (body += chunk))
    req.on('end', () => {
      const parsed = JSON.parse(body)
      received.push({
        messageId: parsed.header.message_id,
        payload: parsed.payload,
      })
      const status = statuses[received.length - 1] ?? 200
      setTimeout(() => {
        inFlight--
        res.writeHead(status)
        res.end(`status ${status}`)
      }, 5)
    })
  })
  await new Promise<void>(resolve => {
    server.listen(0, resolve)
  })
  const addr = server.address()
  const port = typeof addr === 'object' ? addr!.port : 0
  try {
    await fn(
      {
        notificationsApiUrl: `http://localhost:${port}`,
        notificationsJwt: undefined,
        postgresUrl: 'postgresql://localhost/test',
        postgresSslRootCert: undefined,
        retryMaxAttempts: 0,
        retryBaseDelayMs: 1,
        dryRun: false,
      },
      received,
    )
  } finally {
    await new Promise<void>(resolve => {
      server.close(() => resolve())
    })
  }
  expect(overlapped).toBe(false)
}

function recorder() {
  const marks: [number, PostResult['kind']][] = []
  const mark = (id: number, result: PostResult) => {
    marks.push([id, result.kind])
    return Promise.resolve()
  }
  return { marks, mark }
}

describe('sendPendingEvents', () => {
  it('posts rows one at a time in order and flags superseded rows', async () => {
    await withServer([], async (config, received) => {
      const rows = [
        makeRow(1, { supersededByNewer: true }),
        makeRow(2),
        makeRow(3),
      ]
      const { marks, mark } = recorder()

      const summary = await sendPendingEvents(rows, mark, config, logger)

      expect(received.map(r => r.messageId)).toEqual(rows.map(r => r.messageId))
      expect(received[0]!.payload.superseded_by_newer).toBe(true)
      expect('superseded_by_newer' in received[1]!.payload).toBe(false)
      expect(received[1]!.payload).toEqual(rows[1]!.payload)
      expect(marks).toEqual([
        [1, 'sent'],
        [2, 'sent'],
        [3, 'sent'],
      ])
      expect(summary).toEqual({
        sent: 3,
        rejected: 0,
        failed: 0,
        remaining: 0,
        stoppedBy: null,
        lastError: null,
      })
    })
  })

  it('marks a rejected row and continues', async () => {
    await withServer([400, 200], async (config, received) => {
      const { marks, mark } = recorder()

      const summary = await sendPendingEvents(
        [makeRow(1), makeRow(2)],
        mark,
        config,
        logger,
      )

      expect(received).toHaveLength(2)
      expect(marks).toEqual([
        [1, 'rejected'],
        [2, 'sent'],
      ])
      expect(summary).toEqual({
        sent: 1,
        rejected: 1,
        failed: 0,
        remaining: 0,
        stoppedBy: null,
        lastError: 'HTTP 400: status 400',
      })
    })
  })

  it('stops on unauthorized and leaves the rest pending', async () => {
    await withServer([200, 401], async (config, received) => {
      const { marks, mark } = recorder()

      const summary = await sendPendingEvents(
        [makeRow(1), makeRow(2), makeRow(3)],
        mark,
        config,
        logger,
      )

      expect(received).toHaveLength(2)
      expect(marks).toEqual([
        [1, 'sent'],
        [2, 'unauthorized'],
      ])
      expect(summary).toEqual({
        sent: 1,
        rejected: 0,
        failed: 0,
        remaining: 2,
        stoppedBy: 'unauthorized',
        lastError: 'HTTP 401: status 401',
      })
    })
  })

  it('stops on a retryable failure of the first row', async () => {
    await withServer([503], async (config, received) => {
      const { marks, mark } = recorder()

      const summary = await sendPendingEvents(
        [makeRow(1), makeRow(2)],
        mark,
        config,
        logger,
      )

      expect(received).toHaveLength(1)
      expect(marks).toEqual([[1, 'retryable']])
      expect(summary).toEqual({
        sent: 0,
        rejected: 0,
        failed: 0,
        remaining: 2,
        stoppedBy: 'retryable',
        lastError: 'HTTP 503: status 503',
      })
    })
  })

  it('counts a row on its last attempt as failed', async () => {
    await withServer([503], async (config, received) => {
      const { marks, mark } = recorder()

      const summary = await sendPendingEvents(
        [makeRow(1, { attempts: 9 }), makeRow(2)],
        mark,
        config,
        logger,
      )

      expect(received).toHaveLength(1)
      expect(marks).toEqual([[1, 'retryable']])
      expect(summary).toEqual({
        sent: 0,
        rejected: 0,
        failed: 1,
        remaining: 1,
        stoppedBy: 'retryable',
        lastError: 'HTTP 503: status 503',
      })
    })
  })

  it('sends and marks nothing in dry run', async () => {
    await withServer([], async (config, received) => {
      const { marks, mark } = recorder()

      const summary = await sendPendingEvents(
        [makeRow(1), makeRow(2)],
        mark,
        { ...config, dryRun: true },
        logger,
      )

      expect(received).toHaveLength(0)
      expect(marks).toEqual([])
      expect(summary).toEqual({
        sent: 0,
        rejected: 0,
        failed: 0,
        remaining: 2,
        stoppedBy: null,
        lastError: null,
      })
    })
  })

  it('returns an all-zero summary for no rows', async () => {
    await withServer([], async (config, received) => {
      const { marks, mark } = recorder()

      const summary = await sendPendingEvents([], mark, config, logger)

      expect(received).toHaveLength(0)
      expect(marks).toEqual([])
      expect(summary).toEqual({
        sent: 0,
        rejected: 0,
        failed: 0,
        remaining: 0,
        stoppedBy: null,
        lastError: null,
      })
    })
  })
})
