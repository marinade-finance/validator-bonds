import { execFileSync } from 'child_process'
import { createHmac, randomBytes } from 'crypto'
import { createServer } from 'net'

import { sleep } from '@marinade.finance/ts-common'
import pino from 'pino'

import { createDirectory, DirectoryConflictError } from '../src/directory'
import { persistEvents } from '../src/persist-events'
import { loadPreviousState, saveState } from '../src/state'

import type { AuctionMeta } from '../src/calc-relay'
import type { Directory } from '../src/directory'
import type { BondsEventV1, EmitResult, ValidatorState } from '../src/types'

jest.setTimeout(120_000)

const logger = pino({ level: 'silent' })
const EPOCH = 750
const GCS_IMAGE = 'fsouza/fake-gcs-server:1.56.1'
const DIRECTORY_IMAGE = 'marinade-directory:test'
const JWT_SECRET = 'bonds-eventing-test-secret-at-least-32-bytes'
const BUCKET = 'bonds-eventing-test'

function hasDocker(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, () => {
      const address = server.address()
      const port =
        typeof address === 'string' || address === null ? 0 : address.port
      server.close(() => resolve(port))
    })
  })
}

/** HS256 token carrying the grants this package needs. Leading slash required. */
function mintToken(): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  const header = encode({ alg: 'HS256' })
  const payload = encode({
    sub: 'bonds-eventing-test',
    grants: ['/bonds/**:rw'],
    exp: Math.floor(Date.now() / 1000) + 3600,
  })
  const signature = createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url')
  return `${header}.${payload}.${signature}`
}

async function waitFor(what: string, probe: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await probe().catch(() => false)) return
    await sleep(200)
  }
  throw new Error(`Timed out waiting for ${what}`)
}

function validatorState(voteAccount: string): ValidatorState {
  return {
    vote_account: voteAccount,
    bond_pubkey: `bond-${voteAccount}`,
    bond_type: 'bidding',
    epoch: EPOCH,
    in_auction: true,
    bond_good_for_n_epochs: 4.25,
    cap_constraint: 'BOND',
    cap_marinade_stake_sol: 1234.5,
    funded_amount_lamports: 9_007_199_254_740_993n,
    effective_amount_lamports: 8_000_000_000n,
    auction_stake_lamports: 0n,
    deficit_lamports: 42n,
    settlement_claims_lamports: null,
    sam_eligible: true,
    updated_at: '2026-09-10T00:00:00.000Z',
    auction_validator: { voteAccount, bondBalanceSol: 1.5 },
  }
}

function bondsEvent(voteAccount: string): BondsEventV1 {
  return {
    type: 'bonds',
    inner_type: 'first_seen',
    vote_account: voteAccount,
    bond_pubkey: `bond-${voteAccount}`,
    bond_type: 'bidding',
    epoch: EPOCH,
    data: {
      message: `first seen ${voteAccount}`,
      details: { in_auction: true, bond_balance_sol: 1.5 },
    },
    created_at: '2026-09-10T00:00:00.000Z',
  }
}

const docker = hasDocker()
if (!docker) {
  console.log(
    'Skipping the marinade-directory integration test: docker is unavailable',
  )
}

const describeStore = docker ? describe : describe.skip

describeStore('marinade-directory store', () => {
  const suffix = randomBytes(4).toString('hex')
  const gcsContainer = `bonds-eventing-gcs-${suffix}`
  const directoryContainer = `bonds-eventing-dir-${suffix}`
  let dir: Directory

  beforeAll(async () => {
    const gcsPort = await freePort()
    const directoryPort = await freePort()

    execFileSync(
      'docker',
      [
        ...['run', '-d', '--rm', '--name', gcsContainer, '--network', 'host'],
        GCS_IMAGE,
        ...['-backend', 'memory', '-scheme', 'http'],
        ...['-port', String(gcsPort), '-public-host', `localhost:${gcsPort}`],
      ],
      { stdio: 'ignore' },
    )
    const gcs = `http://localhost:${gcsPort}/storage/v1/b`
    await waitFor('fake-gcs-server', async () => (await fetch(gcs)).ok)

    const bucket = await fetch(`${gcs}?project=demo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: BUCKET, versioning: { enabled: true } }),
    })
    if (!bucket.ok) throw new Error(`Bucket creation failed: ${bucket.status}`)

    execFileSync(
      'docker',
      [
        ...['run', '-d', '--rm'],
        ...['--name', directoryContainer, '--network', 'host'],
        ...['-e', `STORAGE_EMULATOR_HOST=localhost:${gcsPort}`],
        ...['-e', `GCS_BUCKET=${BUCKET}`],
        ...['-e', `JWT_SECRET=${JWT_SECRET}`],
        ...['-e', `PORT=${directoryPort}`, '-e', 'METRICS_PORT=0'],
        DIRECTORY_IMAGE,
      ],
      { stdio: 'ignore' },
    )

    dir = createDirectory(`http://localhost:${directoryPort}`, mintToken())
    await waitFor('marinade-directory', async () => {
      await dir.ready()
      return true
    })
  }, 180_000)

  afterAll(() => {
    try {
      execFileSync('docker', ['rm', '-f', gcsContainer, directoryContainer], {
        stdio: 'ignore',
      })
    } catch (err) {
      console.warn(`Container cleanup failed: ${String(err)}`)
    }
  })

  /**
   * A bond type nothing has written yet reads as an empty map, and the save
   * that follows creates the document. Assumes an empty store. Verifies the
   * absent document yields no etag and that the created one loads back.
   */
  it('starts from an empty map and creates the document', async () => {
    const empty = await loadPreviousState(dir, 'institutional', logger)
    expect(empty.validators.size).toBe(0)
    expect(empty.etag).toBeNull()

    await saveState(
      dir,
      'institutional',
      {
        epoch: EPOCH,
        meta: undefined,
        validators: new Map([['vote1', validatorState('vote1')]]),
      },
      empty.etag,
      logger,
    )

    const loaded = await loadPreviousState(dir, 'institutional', logger)
    expect(loaded.validators.size).toBe(1)
    expect(loaded.etag).not.toBeNull()
  })

  /**
   * State survives the document round trip unchanged. Assumes lamport amounts
   * beyond the double-precision range and a relayed calc blob. Verifies the
   * loaded entry equals the saved one, and that the meta comes back too.
   */
  it('round-trips validator state through the document', async () => {
    // The auction meta is a full DsSamConfig in a real run; the fields the
    // document round trip touches are enough here.
    const meta = {
      epoch: EPOCH,
      winningTotalPmpe: 12.5,
      blacklist: ['vote9'],
    } as AuctionMeta

    await saveState(
      dir,
      'bidding',
      {
        epoch: EPOCH,
        meta,
        validators: new Map([
          ['vote1', validatorState('vote1')],
          ['vote2', validatorState('vote2')],
        ]),
      },
      null,
      logger,
    )

    const loaded = await loadPreviousState(dir, 'bidding', logger)
    expect(loaded.validators.get('vote1')).toEqual(validatorState('vote1'))
    expect(loaded.validators.get('vote2')?.funded_amount_lamports).toBe(
      9_007_199_254_740_993n,
    )
    expect(loaded.meta?.epoch).toBe(EPOCH)
  })

  /**
   * A save built on a version another writer has replaced is refused. Assumes
   * the document written by the previous test. Verifies the second save with
   * the same etag raises a conflict rather than writing or retrying.
   */
  it('refuses a save carrying a stale etag', async () => {
    const loaded = await loadPreviousState(dir, 'bidding', logger)
    const doc = {
      epoch: EPOCH,
      meta: loaded.meta,
      validators: loaded.validators,
    }

    await saveState(dir, 'bidding', doc, loaded.etag, logger)

    await expect(
      saveState(dir, 'bidding', doc, loaded.etag, logger),
    ).rejects.toBeInstanceOf(DirectoryConflictError)
  })

  /**
   * A message id is minted per POST, so the store refusing the create-only PUT
   * means two ids collided, not that the event was already recorded. Assumes
   * the first call stored the record. Verifies the second call surfaces the
   * conflict and leaves the first record standing.
   */
  it('surfaces a 412 on an event PUT', async () => {
    const event = bondsEvent('vote1')
    const result: EmitResult = { status: 'sent', messageId: `msg-${suffix}` }
    const results = new Map<BondsEventV1, EmitResult>([[event, result]])

    await persistEvents(dir, results, logger)

    await expect(persistEvents(dir, results, logger)).rejects.toBeInstanceOf(
      DirectoryConflictError,
    )

    const stored = await dir.get(
      `/bonds/events/bidding/${EPOCH}/${result.messageId}`,
    )
    expect(stored?.body).toMatchObject({
      message_id: result.messageId,
      inner_type: 'first_seen',
      status: 'sent',
      error: null,
    })
  })
})
