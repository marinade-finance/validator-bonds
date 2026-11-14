import { randomUUID } from 'crypto'

import pino from 'pino'
import { sql } from 'slonik'

import { createEventingPool } from '../src/db'
import {
  insertPendingEvents,
  loadPendingEvents,
  markEvent,
} from '../src/persist-events'
import { runEventingPipeline } from '../src/pipeline'
import { saveAuctionMeta } from '../src/state'

import type { AuctionMeta } from '../src/calc-relay'
import type {
  BondType,
  BondsEventV1,
  EventingConfig,
  ValidatorState,
} from '../src/types'
import type { DatabasePool } from 'slonik'

const logger = pino({ level: 'silent' })
const TEST_POSTGRES_URL = process.env.TEST_POSTGRES_URL
const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const BOND_TYPE = `test-${randomUUID()}` as BondType

if (!TEST_POSTGRES_URL) {
  console.log('TEST_POSTGRES_URL not set, skipping outbox DB tests')
}
const describeDb = TEST_POSTGRES_URL ? describe : describe.skip

function makeEvent(overrides: Partial<BondsEventV1> = {}): BondsEventV1 {
  return {
    type: 'bonds',
    inner_type: 'bond_balance_change',
    vote_account: 'vote111',
    bond_pubkey: 'bond111',
    bond_type: BOND_TYPE,
    epoch: 930,
    data: { message: 'Test message', details: {} },
    created_at: '2026-11-14T10:00:00.000Z',
    ...overrides,
  }
}

interface EventRow {
  id: number
  message_id: string
  vote_account: string
  status: string
  attempts: number
  error: string | null
  last_attempt_at: string | null
  payload: BondsEventV1
}

describeDb('outbox DB', () => {
  let pool: DatabasePool

  beforeAll(async () => {
    pool = await createEventingPool(TEST_POSTGRES_URL!, undefined)
  })

  afterAll(async () => {
    await pool.query(
      sql.unsafe`DELETE FROM emitted_bond_events WHERE bond_type = ${BOND_TYPE}`,
    )
    await pool.query(
      sql.unsafe`DELETE FROM bond_event_state WHERE bond_type = ${BOND_TYPE}`,
    )
    await pool.query(
      sql.unsafe`DELETE FROM bond_event_meta WHERE bond_type = ${BOND_TYPE}`,
    )
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query(
      sql.unsafe`DELETE FROM emitted_bond_events WHERE bond_type = ${BOND_TYPE}`,
    )
  })

  async function eventRows(): Promise<EventRow[]> {
    const result = await pool.query(sql.unsafe`
      SELECT id, message_id, vote_account, status, attempts, error,
        last_attempt_at, payload
      FROM emitted_bond_events WHERE bond_type = ${BOND_TYPE} ORDER BY id
    `)
    return result.rows as unknown as EventRow[]
  }

  it('insertPendingEvents stores pending rows in input order', async () => {
    const events = [
      makeEvent({ vote_account: 'voteA' }),
      makeEvent({
        vote_account: 'voteB',
        data: { message: 'NaN detail', details: { value: NaN } },
      }),
      makeEvent({ vote_account: 'voteC' }),
    ]

    await insertPendingEvents(pool, events, logger)

    const rows = await eventRows()
    expect(rows.map(r => r.vote_account)).toEqual(['voteA', 'voteB', 'voteC'])
    for (const row of rows) {
      expect(row.status).toBe('pending')
      expect(row.attempts).toBe(0)
      expect(row.error).toBeNull()
      expect(row.last_attempt_at).toBeNull()
      expect(row.message_id).toMatch(UUID_V7)
      expect(row.payload.created_at).toBe('2026-11-14T10:00:00.000Z')
    }
    expect(new Set(rows.map(r => r.message_id)).size).toBe(3)
    expect(rows[1]!.payload.data.details).toEqual({ value: null })
  })

  it('insertPendingEvents with no events writes nothing', async () => {
    await insertPendingEvents(pool, [], logger)
    expect(await eventRows()).toEqual([])
  })

  describe('loadPendingEvents and markEvent', () => {
    async function insert(voteAccount: string, innerType = 'first_seen') {
      await insertPendingEvents(
        pool,
        [
          makeEvent({
            vote_account: voteAccount,
            inner_type: innerType as BondsEventV1['inner_type'],
          }),
        ],
        logger,
      )
      const rows = await eventRows()
      return rows[rows.length - 1]!.id
    }

    async function row(id: number) {
      return (await eventRows()).find(r => r.id === id)!
    }

    it('loads only pending rows of the bond type in id order', async () => {
      const a = await insert('voteA')
      const b = await insert('voteB')
      const c = await insert('voteC')
      await markEvent(pool, b, { kind: 'sent' })

      const pending = await loadPendingEvents(pool, BOND_TYPE)

      expect(pending.map(p => p.id)).toEqual([a, c])
      expect(pending[0]!.payload.vote_account).toBe('voteA')
      expect(pending[0]!.attempts).toBe(0)
      expect(pending[0]!.messageId).toMatch(UUID_V7)
      expect(await loadPendingEvents(pool, 'bidding')).not.toContainEqual(
        expect.objectContaining({ id: a }),
      )
    })

    it('flags the older of two pending rows with the same key as superseded', async () => {
      const older = await insert('voteA', 'bond_balance_change')
      const otherType = await insert('voteA', 'cap_changed')
      const newer = await insert('voteA', 'bond_balance_change')
      const sentNewer = await insert('voteA', 'cap_changed')
      await markEvent(pool, sentNewer, { kind: 'sent' })

      const pending = await loadPendingEvents(pool, BOND_TYPE)

      expect(pending.map(p => [p.id, p.supersededByNewer])).toEqual([
        [older, true],
        [otherType, false],
        [newer, false],
      ])
    })

    it('writes the columns of each result kind', async () => {
      const sent = await insert('voteA')
      const rejected = await insert('voteB')
      const unauthorized = await insert('voteC')
      const retryable = await insert('voteD')
      const unavailable = await insert('voteE')

      await markEvent(pool, sent, { kind: 'sent' })
      await markEvent(pool, rejected, { kind: 'rejected', error: 'HTTP 400' })
      await markEvent(pool, unauthorized, {
        kind: 'unauthorized',
        error: 'HTTP 401',
      })
      await markEvent(pool, retryable, {
        kind: 'retryable',
        error: 'HTTP 404',
      })
      await markEvent(pool, unavailable, {
        kind: 'unavailable',
        error: 'HTTP 503',
      })

      const pick = (r: EventRow) => ({
        status: r.status,
        attempts: r.attempts,
        error: r.error,
        attempted: r.last_attempt_at !== null,
      })
      expect(pick(await row(sent))).toEqual({
        status: 'sent',
        attempts: 0,
        error: null,
        attempted: true,
      })
      expect(pick(await row(rejected))).toEqual({
        status: 'rejected',
        attempts: 0,
        error: 'HTTP 400',
        attempted: true,
      })
      expect(pick(await row(unauthorized))).toEqual({
        status: 'pending',
        attempts: 0,
        error: 'HTTP 401',
        attempted: true,
      })
      expect(pick(await row(retryable))).toEqual({
        status: 'pending',
        attempts: 1,
        error: 'HTTP 404',
        attempted: true,
      })
      expect(pick(await row(unavailable))).toEqual({
        status: 'pending',
        attempts: 0,
        error: 'HTTP 503',
        attempted: true,
      })
    })

    it('marks a row failed after ten retryable attempts', async () => {
      const id = await insert('voteA')
      for (let i = 0; i < 9; i++) {
        await markEvent(pool, id, { kind: 'retryable', error: 'HTTP 404' })
      }
      expect((await row(id)).status).toBe('pending')

      await markEvent(pool, id, { kind: 'retryable', error: 'HTTP 404' })

      expect(await row(id)).toMatchObject({ status: 'failed', attempts: 10 })
    })

    it('keeps a row ignored when a retryable result arrives late', async () => {
      const id = await insert('voteA')
      await pool.query(
        sql.unsafe`UPDATE emitted_bond_events SET status = 'ignored' WHERE id = ${id}`,
      )

      await markEvent(pool, id, { kind: 'retryable', error: 'HTTP 404' })

      expect(await row(id)).toMatchObject({ status: 'ignored', attempts: 0 })
    })
  })

  describe('runEventingPipeline', () => {
    interface TestValidator {
      voteAccount: string
    }

    function makeConfig(
      overrides: Partial<EventingConfig> = {},
    ): EventingConfig {
      return {
        bondsApiUrl: '',
        validatorsApiUrl: '',
        scoringApiUrl: '',
        tvlApiUrl: '',
        institutionalApiUrl: '',
        postgresUrl: TEST_POSTGRES_URL,
        postgresSslRootCert: undefined,
        dryRun: false,
        cacheInputs: undefined,
        ...overrides,
      }
    }

    function toState(v: TestValidator, epoch: number): ValidatorState {
      return {
        vote_account: v.voteAccount,
        bond_pubkey: null,
        bond_type: BOND_TYPE,
        epoch,
        in_auction: false,
        bond_good_for_n_epochs: null,
        cap_constraint: null,
        cap_marinade_stake_sol: null,
        funded_amount_lamports: 0n,
        effective_amount_lamports: 0n,
        auction_stake_lamports: 0n,
        deficit_lamports: 0n,
        settlement_claims_lamports: null,
        sam_eligible: false,
        updated_at: new Date().toISOString(),
      }
    }

    function run(
      validators: TestValidator[],
      epoch: number,
      events: BondsEventV1[],
      opts: {
        config?: Partial<EventingConfig>
        saveMeta?: (tx: Parameters<typeof saveAuctionMeta>[0]) => Promise<void>
      } = {},
    ) {
      return runEventingPipeline({
        bondType: BOND_TYPE,
        config: makeConfig(opts.config),
        logger,
        validators,
        epoch,
        voteAccountOf: v => v.voteAccount,
        evaluate: () => events,
        toState,
        saveMeta:
          opts.saveMeta ??
          (tx =>
            saveAuctionMeta(
              tx,
              BOND_TYPE,
              { epoch } as unknown as AuctionMeta,
              logger,
            )),
      })
    }

    async function snapshot() {
      const states = await pool.query(sql.unsafe`
        SELECT vote_account, epoch FROM bond_event_state
        WHERE bond_type = ${BOND_TYPE} ORDER BY vote_account
      `)
      const meta = await pool.maybeOne(sql.unsafe`
        SELECT epoch FROM bond_event_meta WHERE bond_type = ${BOND_TYPE}
      `)
      const events = await eventRows()
      return {
        states: states.rows,
        metaEpoch: (meta as { epoch: number } | null)?.epoch ?? null,
        events: events.map(e => [e.vote_account, e.status]),
      }
    }

    beforeEach(async () => {
      await pool.query(
        sql.unsafe`DELETE FROM bond_event_state WHERE bond_type = ${BOND_TYPE}`,
      )
      await pool.query(
        sql.unsafe`DELETE FROM bond_event_meta WHERE bond_type = ${BOND_TYPE}`,
      )
    })

    it('stores all states, pending events and meta, then deletes a removed validator', async () => {
      await run([{ voteAccount: 'voteA' }, { voteAccount: 'voteB' }], 900, [
        makeEvent({ vote_account: 'voteA' }),
      ])
      expect(await snapshot()).toEqual({
        states: [
          { vote_account: 'voteA', epoch: 900 },
          { vote_account: 'voteB', epoch: 900 },
        ],
        metaEpoch: 900,
        events: [['voteA', 'pending']],
      })

      await run([{ voteAccount: 'voteA' }], 901, [
        makeEvent({ vote_account: 'voteB', inner_type: 'validator_delisted' }),
      ])
      expect(await snapshot()).toEqual({
        states: [{ vote_account: 'voteA', epoch: 901 }],
        metaEpoch: 901,
        events: [
          ['voteA', 'pending'],
          ['voteB', 'pending'],
        ],
      })
    })

    it('rolls back every write when the meta save fails', async () => {
      await run([{ voteAccount: 'voteA' }], 900, [makeEvent()])
      const before = await snapshot()

      await expect(
        run(
          [{ voteAccount: 'voteA' }, { voteAccount: 'voteB' }],
          901,
          [makeEvent({ vote_account: 'voteB' })],
          {
            saveMeta: () => Promise.reject(new Error('meta write failed')),
          },
        ),
      ).rejects.toThrow('meta write failed')

      expect(await snapshot()).toEqual(before)
    })

    it('writes nothing in dry run', async () => {
      await run([{ voteAccount: 'voteA' }], 900, [makeEvent()])
      const before = await snapshot()

      await run([{ voteAccount: 'voteB' }], 901, [makeEvent()], {
        config: { dryRun: true },
      })

      expect(await snapshot()).toEqual(before)
    })
  })
})
