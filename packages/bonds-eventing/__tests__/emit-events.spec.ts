import http from 'http'

import pino from 'pino'

import { emitEvents } from '../src/emit-events'

import type { BondsEventV1, EventingConfig } from '../src/types'

const logger = pino({ level: 'silent' })

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
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeConfig(overrides: Partial<EventingConfig> = {}): EventingConfig {
  return {
    bondsApiUrl: 'https://validator-bonds-api.marinade.finance',
    validatorsApiUrl: 'https://validators-api.marinade.finance',
    scoringApiUrl: 'https://scoring.marinade.finance',
    tvlApiUrl: 'https://api.marinade.finance',
    notificationsApiUrl: undefined,
    notificationsJwt: undefined,
    postgresUrl: undefined,
    postgresSslRootCert: undefined,
    retryMaxAttempts: 2,
    retryBaseDelayMs: 10, // fast for tests
    emitConcurrency: 20,
    dryRun: false,
    cacheInputs: undefined,
    ...overrides,
  }
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

describe('emitEvents', () => {
  it('marks events as failed when no notifications URL configured', async () => {
    const events = [makeEvent()]
    const config = makeConfig({ notificationsApiUrl: undefined })

    const results = await emitEvents(events, config, logger)

    expect(results.get(events[0]!)!.status).toBe('failed')
    expect(results.get(events[0]!)!.error).toContain('No notifications API URL')
  })

  it('dry run marks all as sent without HTTP calls', async () => {
    const events = [makeEvent(), makeEvent({ vote_account: 'vote222' })]
    const config = makeConfig({ dryRun: true })

    const results = await emitEvents(events, config, logger)

    expect(results.size).toBe(2)
    for (const result of results.values()) {
      expect(result.status).toBe('sent')
    }
  })

  it('returns empty map for no events', async () => {
    const config = makeConfig()
    const results = await emitEvents([], config, logger)
    expect(results.size).toBe(0)
  })

  it('POSTs events and returns sent on 200', async () => {
    const receivedBodies: string[] = []
    const { port, close } = await createTestServer((req, res) => {
      let body = ''
      req.on('data', chunk => (body += chunk))
      req.on('end', () => {
        receivedBodies.push(body)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{"ok":true}')
      })
    })

    try {
      const events = [makeEvent()]
      const config = makeConfig({
        notificationsApiUrl: `http://localhost:${port}`,
        notificationsJwt: 'test-jwt',
      })

      const results = await emitEvents(events, config, logger)

      expect(results.get(events[0]!)!.status).toBe('sent')
      expect(receivedBodies).toHaveLength(1)

      const parsed = JSON.parse(receivedBodies[0]!)
      // Event is wrapped in Message<T> envelope
      expect(parsed.header).toBeDefined()
      expect(parsed.header.producer_id).toBe('bonds-eventing')
      expect(parsed.header.message_id).toBeDefined()
      expect(parsed.header.created_at).toBeDefined()
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
      const events = [makeEvent()]
      const config = makeConfig({
        notificationsApiUrl: `http://localhost:${port}`,
        retryMaxAttempts: 4,
        retryBaseDelayMs: 10,
      })

      const results = await emitEvents(events, config, logger)

      expect(results.get(events[0]!)!.status).toBe('sent')
      expect(requestCount).toBe(3)
    } finally {
      await close()
    }
  })

  it('fails after retry exhaustion', async () => {
    const { port, close } = await createTestServer((_req, res) => {
      res.writeHead(503)
      res.end('Service Unavailable')
    })

    try {
      const events = [makeEvent()]
      const config = makeConfig({
        notificationsApiUrl: `http://localhost:${port}`,
        retryMaxAttempts: 1,
        retryBaseDelayMs: 10,
      })

      const results = await emitEvents(events, config, logger)

      expect(results.get(events[0]!)!.status).toBe('failed')
      expect(results.get(events[0]!)!.error).toContain('503')
    } finally {
      await close()
    }
  })

  it('does not retry on 400 client error', async () => {
    let requestCount = 0
    const { port, close } = await createTestServer((_req, res) => {
      requestCount++
      res.writeHead(400)
      res.end('Bad Request')
    })

    try {
      const events = [makeEvent()]
      const config = makeConfig({
        notificationsApiUrl: `http://localhost:${port}`,
        retryMaxAttempts: 3,
        retryBaseDelayMs: 10,
      })

      const results = await emitEvents(events, config, logger)

      expect(results.get(events[0]!)!.status).toBe('failed')
      expect(requestCount).toBe(1) // No retries on 4xx
    } finally {
      await close()
    }
  })
})
