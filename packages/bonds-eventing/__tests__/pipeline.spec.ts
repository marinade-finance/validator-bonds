import pino from 'pino'

import { DirectoryConflictError } from '../src/directory'
import { runEventingPipeline } from '../src/pipeline'

import type { AuctionMeta } from '../src/calc-relay'
import type { Directory, DirectoryDoc, PutPrecondition } from '../src/directory'
import type { BondsEventV1, EventingConfig, ValidatorState } from '../src/types'

const logger = pino({ level: 'silent' })
const EPOCH = 750
const STATE_PATH = '/bonds/eventing/bidding'

const config = {
  notificationsApiUrl: 'https://notifications.test',
  notificationsJwt: undefined,
  directoryUrl: 'https://directory.test',
  directoryToken: 'test-token',
  retryMaxAttempts: 0,
  retryBaseDelayMs: 0,
  emitConcurrency: 4,
  dryRun: false,
} as EventingConfig

interface StoredDoc {
  body: unknown
  etag: string
}

interface FakeDirectory extends Directory {
  docs: Map<string, StoredDoc>
}

/** In-memory stand-in for marinade-directory: same preconditions, no network. */
function fakeDirectory(): FakeDirectory {
  const docs = new Map<string, StoredDoc>()
  let version = 0

  return {
    docs,
    get(path: string): Promise<DirectoryDoc | null> {
      const stored = docs.get(path)
      if (stored === undefined) return Promise.resolve(null)
      const body: unknown = JSON.parse(JSON.stringify(stored.body))
      return Promise.resolve({ body, etag: stored.etag })
    },
    put(
      path: string,
      body: unknown,
      precondition: PutPrecondition,
    ): Promise<string> {
      const stored = docs.get(path)
      if ('create' in precondition) {
        if (stored !== undefined)
          return Promise.reject(new DirectoryConflictError(path))
      } else if (stored === undefined || stored.etag !== precondition.ifMatch) {
        return Promise.reject(new DirectoryConflictError(path))
      }
      version += 1
      const etag = `"v${version}"`
      docs.set(path, {
        body: JSON.parse(JSON.stringify(body)) as unknown,
        etag,
      })
      return Promise.resolve(etag)
    },
    ready(): Promise<void> {
      return Promise.resolve()
    },
  }
}

interface TestValidator {
  voteAccount: string
  funded: bigint
}

function state(voteAccount: string, funded: bigint): ValidatorState {
  return {
    vote_account: voteAccount,
    bond_pubkey: `bond-${voteAccount}`,
    bond_type: 'bidding',
    epoch: EPOCH,
    in_auction: true,
    bond_good_for_n_epochs: 5,
    cap_constraint: 'BOND',
    cap_marinade_stake_sol: 1000,
    funded_amount_lamports: funded,
    effective_amount_lamports: funded,
    auction_stake_lamports: 7n,
    deficit_lamports: 0n,
    settlement_claims_lamports: null,
    sam_eligible: true,
    updated_at: '2026-09-10T00:00:00.000Z',
    auction_validator: { voteAccount, bondBalanceSol: 1.5 },
  }
}

function event(voteAccount: string): BondsEventV1 {
  return {
    type: 'bonds',
    inner_type: 'bond_balance_change',
    vote_account: voteAccount,
    bond_pubkey: `bond-${voteAccount}`,
    bond_type: 'bidding',
    epoch: EPOCH,
    data: {
      message: `changed ${voteAccount}`,
      details: { in_auction: true },
    },
    created_at: '2026-09-10T00:00:00.000Z',
  }
}

function mockNotifications(failFor: string[] = []) {
  const failing = new Set(failFor)
  return jest.fn((_url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? init.body : ''
    const message = JSON.parse(body) as { payload: BondsEventV1 }
    const ok = !failing.has(message.payload.vote_account)
    return Promise.resolve({
      ok,
      status: ok ? 200 : 400,
      text: () => Promise.resolve(ok ? 'ok' : 'rejected'),
    } as Response)
  })
}

interface StateDocBody {
  epoch: number
  meta?: AuctionMeta
  validators: Record<string, Record<string, unknown>>
}

function savedDoc(dir: FakeDirectory): StateDocBody {
  const stored = dir.docs.get(STATE_PATH)
  if (stored === undefined) throw new Error('no state document was saved')
  return stored.body as StateDocBody
}

async function seed(
  dir: FakeDirectory,
  validators: ValidatorState[],
  meta?: AuctionMeta,
): Promise<void> {
  const entries: Record<string, unknown> = {}
  for (const s of validators) {
    entries[s.vote_account] = {
      ...s,
      funded_amount_lamports: s.funded_amount_lamports.toString(),
      effective_amount_lamports: s.effective_amount_lamports.toString(),
      auction_stake_lamports: s.auction_stake_lamports.toString(),
      deficit_lamports: s.deficit_lamports.toString(),
      settlement_claims_lamports: null,
    }
  }
  await dir.put(
    STATE_PATH,
    { epoch: EPOCH - 1, meta, validators: entries },
    { create: true },
  )
}

async function run(
  dir: FakeDirectory,
  validators: TestValidator[],
  previousVoteAccounts: string[],
  meta?: AuctionMeta,
  overrides: Partial<EventingConfig> = {},
): Promise<void> {
  await runEventingPipeline<TestValidator>({
    bondType: 'bidding',
    config: { ...config, ...overrides },
    dir,
    logger,
    validators,
    epoch: EPOCH,
    voteAccountOf: v => v.voteAccount,
    evaluate: vals => {
      const events = vals.map(v => event(v.voteAccount))
      for (const voteAccount of previousVoteAccounts) {
        if (!vals.some(v => v.voteAccount === voteAccount))
          events.push(event(voteAccount))
      }
      return events
    },
    toState: v => state(v.voteAccount, v.funded),
    meta,
  })
}

describe('runEventingPipeline state merge', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  /**
   * A validator whose events all posted is overwritten with its new state.
   * Assumes the document already holds an entry for it from a previous run.
   * Verifies the saved entry carries the current run's values and epoch.
   */
  it('overwrites the entry of a validator whose events all posted', async () => {
    const dir = fakeDirectory()
    await seed(dir, [state('vote1', 100n)])
    global.fetch = mockNotifications() as unknown as typeof fetch

    await run(dir, [{ voteAccount: 'vote1', funded: 300n }], ['vote1'])

    const doc = savedDoc(dir)
    expect(doc.epoch).toBe(EPOCH)
    expect(doc.validators.vote1?.funded_amount_lamports).toBe('300')
  })

  /**
   * A validator with a failed event keeps the entry the previous run wrote,
   * so its delta is evaluated again next run. Assumes the notifications API
   * rejects that validator's event. Verifies neither the amounts nor the
   * relayed calc blob of the stored entry move.
   */
  it('keeps the previous entry of a validator with a failed event', async () => {
    const dir = fakeDirectory()
    await seed(dir, [state('vote1', 100n)])
    global.fetch = mockNotifications(['vote1']) as unknown as typeof fetch

    await run(dir, [{ voteAccount: 'vote1', funded: 300n }], ['vote1'])

    const entry = savedDoc(dir).validators.vote1
    expect(entry?.funded_amount_lamports).toBe('100')
    expect(entry?.auction_validator).toEqual({
      voteAccount: 'vote1',
      bondBalanceSol: 1.5,
    })
  })

  /**
   * A validator that disappeared from the run's input is dropped once its
   * delist event posted. Assumes the document holds it and the current input
   * does not. Verifies it is gone from the saved document.
   */
  it('removes a delisted validator whose event posted', async () => {
    const dir = fakeDirectory()
    await seed(dir, [state('vote1', 100n), state('vote2', 200n)])
    global.fetch = mockNotifications() as unknown as typeof fetch

    await run(dir, [{ voteAccount: 'vote1', funded: 100n }], ['vote1', 'vote2'])

    const doc = savedDoc(dir)
    expect(Object.keys(doc.validators)).toEqual(['vote1'])
  })

  /**
   * A delisted validator whose delist event failed stays in the document, so
   * the event is emitted again next run. Assumes the notifications API rejects
   * that event. Verifies the entry survives with its previous values.
   */
  it('keeps a delisted validator whose event failed', async () => {
    const dir = fakeDirectory()
    await seed(dir, [state('vote1', 100n), state('vote2', 200n)])
    global.fetch = mockNotifications(['vote2']) as unknown as typeof fetch

    await run(dir, [{ voteAccount: 'vote1', funded: 100n }], ['vote1', 'vote2'])

    const doc = savedDoc(dir)
    expect(Object.keys(doc.validators).sort()).toEqual(['vote1', 'vote2'])
    expect(doc.validators.vote2?.funded_amount_lamports).toBe('200')
  })

  /**
   * The auction meta the run computed lands in the document beside the
   * validators. Assumes a meta carrying a non-finite field, as the SDK
   * produces. Verifies the meta is stored and non-finite numbers become null.
   */
  it('stores the auction meta in the document', async () => {
    const dir = fakeDirectory()
    await seed(dir, [state('vote1', 100n)])
    global.fetch = mockNotifications() as unknown as typeof fetch
    const meta = {
      epoch: EPOCH,
      winningTotalPmpe: 12.5,
      marinadeSamTvlSol: NaN,
      blacklist: ['vote9'],
    } as AuctionMeta

    await run(dir, [{ voteAccount: 'vote1', funded: 100n }], ['vote1'], meta)

    const doc = savedDoc(dir)
    expect(doc.meta?.epoch).toBe(EPOCH)
    expect(doc.meta?.winningTotalPmpe).toBe(12.5)
    expect(doc.meta?.marinadeSamTvlSol).toBeNull()
  })

  /**
   * A run against a store with no document is refused, since every validator
   * would be notified as first_seen. Assumes an empty store and no
   * allowEmptyState. Verifies the run throws before posting or writing.
   */
  it('refuses an empty store unless told it is the first run', async () => {
    const dir = fakeDirectory()
    const notify = mockNotifications()
    global.fetch = notify as unknown as typeof fetch

    await expect(
      run(dir, [{ voteAccount: 'vote1', funded: 100n }], []),
    ).rejects.toThrow('--allow-empty-state')

    expect(notify).not.toHaveBeenCalled()
    expect(dir.docs.size).toBe(0)
  })

  /**
   * allowEmptyState lets a first run create the document. Assumes an empty
   * store. Verifies the document appears with the run's validators and that
   * each emitted event is recorded.
   */
  it('creates the document on a first run that is allowed', async () => {
    const dir = fakeDirectory()
    global.fetch = mockNotifications() as unknown as typeof fetch

    await run(dir, [{ voteAccount: 'vote1', funded: 100n }], [], undefined, {
      allowEmptyState: true,
    })

    expect(Object.keys(savedDoc(dir).validators)).toEqual(['vote1'])
    const eventPaths = [...dir.docs.keys()].filter(p =>
      p.startsWith(`/bonds/events/bidding/${EPOCH}/`),
    )
    expect(eventPaths).toHaveLength(1)
  })

  /**
   * A concurrent run that wrote the document while this one was emitting makes
   * the save fail. Assumes the fake store bumps the etag behind the run's back.
   * Verifies the conflict propagates instead of being retried.
   */
  it('propagates a conflict on the state save', async () => {
    const dir = fakeDirectory()
    await seed(dir, [state('vote1', 100n)])
    const notify = mockNotifications()
    let raced = false
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      const response = await notify(url, init)
      if (!raced) {
        raced = true
        const current = dir.docs.get(STATE_PATH)
        await dir.put(
          STATE_PATH,
          { epoch: EPOCH, validators: {} },
          { ifMatch: current?.etag ?? '' },
        )
      }
      return response
    }) as unknown as typeof fetch

    await expect(
      run(dir, [{ voteAccount: 'vote1', funded: 300n }], ['vote1']),
    ).rejects.toThrow(DirectoryConflictError)
  })
})
