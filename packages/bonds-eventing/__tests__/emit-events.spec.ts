import http from 'http'

import pino from 'pino'

import { postEvent } from '../src/emit-events'

import type { BondsEventV1, SendConfig } from '../src/types'

const logger = pino({ level: 'silent' })
const MESSAGE_ID = '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'
const CREATED_AT_MS = Date.parse('2026-11-14T10:00:00.000Z')

function makeEvent(overrides: Partial<BondsEventV1> = {}): BondsEventV1 {
  return {
    type: 'bonds',
    inner_type: 'bond_underfunded_change',
    vote_account: 'vote111',
    bond_pubkey: 'bond111',
    bond_type: 'bidding',
    epoch: 930,
    data: {
      message: 'Test message',
      details: { test: true },
    },
    created_at: new Date(CREATED_AT_MS).toISOString(),
    ...overrides,
  }
}

function makeConfig(overrides: Partial<SendConfig> = {}): SendConfig {
  return {
    notificationsApiUrl: undefined,
    notificationsJwt: undefined,
    postgresUrl: 'postgresql://localhost/test',
    postgresSslRootCert: undefined,
    retryMaxAttempts: 2,
    retryBaseDelayMs: 10, // fast for tests
    dryRun: false,
    summaryFile: undefined,
    ...overrides,
  }
}

function makeMessage(payload: object = makeEvent()) {
  return { messageId: MESSAGE_ID, createdAtMs: CREATED_AT_MS, payload }
}

function createTestServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
  return new Promise(resolve => {
    const server = http.createServer(handler)
    server.listen(0, () => {
      const addr = server.address()
      const port = typeof addr === 'object' ? addr!.port : 0
      resolve({
        server,
        port,
        close: () =>
          new Promise<void>(closeResolve => {
            server.close(() => closeResolve())
          }),
      })
    })
  })
}

async function postWithStatus(
  status: number,
  retryMaxAttempts: number,
): Promise<{ result: Awaited<ReturnType<typeof postEvent>>; count: number }> {
  let count = 0
  const { port, close } = await createTestServer((_req, res) => {
    count++
    res.writeHead(status)
    res.end(`status ${status}`)
  })
  try {
    const result = await postEvent(
      makeMessage(),
      makeConfig({
        notificationsApiUrl: `http://localhost:${port}`,
        retryMaxAttempts,
      }),
      logger,
    )
    return { result, count }
  } finally {
    await close()
  }
}

describe('postEvent', () => {
  it('POSTs the stored message in the envelope and returns sent on 200', async () => {
    const received: { body: string; auth: string | undefined }[] = []
    const { port, close } = await createTestServer((req, res) => {
      let body = ''
      req.on('data', chunk => (body += chunk))
      req.on('end', () => {
        received.push({ body, auth: req.headers.authorization })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{"ok":true}')
      })
    })

    try {
      const event = makeEvent()
      const result = await postEvent(
        makeMessage(event),
        makeConfig({
          notificationsApiUrl: `http://localhost:${port}`,
          notificationsJwt: 'test-jwt',
        }),
        logger,
      )

      expect(result).toEqual({ kind: 'sent' })
      expect(received).toHaveLength(1)
      expect(received[0]!.auth).toBe('Bearer test-jwt')

      const parsed = JSON.parse(received[0]!.body)
      expect(parsed.header.producer_id).toBe('bonds-eventing')
      expect(parsed.header.message_id).toBe(MESSAGE_ID)
      expect(parsed.header.created_at).toBe(CREATED_AT_MS)
      expect(parsed.payload).toEqual(event)
      expect(parsed.payload.type).toBe('bonds')
      expect(parsed.payload.inner_type).toBe('bond_underfunded_change')
    } finally {
      await close()
    }
  })

  it('retries on 503 and succeeds', async () => {
    let requestCount = 0
    const { port, close } = await createTestServer((_req, res) => {
      requestCount++
      if (requestCount <= 2) {
        res.writeHead(503)
        res.end('Service Unavailable')
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{"ok":true}')
      }
    })

    try {
      const result = await postEvent(
        makeMessage(),
        makeConfig({
          notificationsApiUrl: `http://localhost:${port}`,
          retryMaxAttempts: 4,
        }),
        logger,
      )

      expect(result).toEqual({ kind: 'sent' })
      expect(requestCount).toBe(3)
    } finally {
      await close()
    }
  })

  it.each([500, 503])(
    'returns unavailable on %i after retry exhaustion',
    async status => {
      const { result, count } = await postWithStatus(status, 1)
      expect(result).toEqual({
        kind: 'unavailable',
        error: `HTTP ${status}: status ${status}`,
      })
      expect(count).toBe(2)
    },
  )

  it.each([400, 422])('rejects on %i without retry', async status => {
    const { result, count } = await postWithStatus(status, 3)
    expect(result).toEqual({
      kind: 'rejected',
      error: `HTTP ${status}: status ${status}`,
    })
    expect(count).toBe(1)
  })

  it.each([401, 403])(
    'reports unauthorized on %i without retry',
    async status => {
      const { result, count } = await postWithStatus(status, 3)
      expect(result).toEqual({
        kind: 'unauthorized',
        error: `HTTP ${status}: status ${status}`,
      })
      expect(count).toBe(1)
    },
  )

  it.each([429, 404])('retries %i and then returns retryable', async status => {
    const { result, count } = await postWithStatus(status, 2)
    expect(result).toEqual({
      kind: 'retryable',
      error: `HTTP ${status}: status ${status}`,
    })
    expect(count).toBe(3)
  })

  it('returns unavailable with the cause code when the connection is refused', async () => {
    const { port, close } = await createTestServer(() => {})
    await close()
    const result = await postEvent(
      makeMessage(),
      makeConfig({
        notificationsApiUrl: `http://127.0.0.1:${port}`,
        retryMaxAttempts: 0,
      }),
      logger,
    )
    expect(result).toEqual({
      kind: 'unavailable',
      error: 'fetch failed: ECONNREFUSED',
    })
  })

  it('truncates a long error body to 1000 characters', async () => {
    const { port, close } = await createTestServer((_req, res) => {
      res.writeHead(400)
      res.end('x'.repeat(5000))
    })
    try {
      const result = await postEvent(
        makeMessage(),
        makeConfig({ notificationsApiUrl: `http://localhost:${port}` }),
        logger,
      )
      expect(result.kind !== 'sent' && result.error.length).toBe(1000)
    } finally {
      await close()
    }
  })
})
