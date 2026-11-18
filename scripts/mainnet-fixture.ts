#!/usr/bin/env bun
/* eslint-disable n/no-process-exit */
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import { join } from 'node:path'

// ProgramData PDA of the stake program under the upgradeable loader; fixed for the program's life
const STAKE_PROGRAM_DATA = '6WU8Nxarf9fudRK5atWwjLY4vFaw5UrrWhL88qz7iCMJ'
const FEATURE_PROGRAM = 'Feature111111111111111111111111111111111111'
const PROGRAM_DATA_HEADER = 45
const FIXTURE_DIR = join(import.meta.dir, '..', 'fixtures', 'mainnet')
const ELF_PATH = join(FIXTURE_DIR, 'stake_program.so')
const MANIFEST_PATH = join(FIXTURE_DIR, 'stake_program.json')
const FEATURES_PATH = join(FIXTURE_DIR, 'features.json')

type Manifest = {
  cluster: string
  programId: string
  programData: string
  deploySlot: number
  size: number
  sha256: string
}

type Features = { activated: Record<string, number> }

if (process.argv.includes('-h') || process.argv.includes('--help')) {
  process.stderr.write(
    'Pins the mainnet stake program binary and feature set used by the LiteSVM tests.\n' +
      '\n' +
      'usage: bun scripts/mainnet-fixture.ts [--check]\n' +
      '  (default)  rewrite fixtures/mainnet/ from mainnet\n' +
      '  --check    exit 1 when mainnet runs a different stake program or feature set\n' +
      '\n' +
      'env: RPC_URL  mainnet RPC (default: https://api.mainnet-beta.solana.com)\n',
  )
  process.exit(0)
}

const rpcUrl = process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com'

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'curl/8.5.0' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!res.ok) {
    throw new Error(`${method}: HTTP ${res.status}`)
  }
  const body = (await res.json()) as { result?: T; error?: unknown }
  if (body.result === undefined) {
    throw new Error(`${method}: ${JSON.stringify(body.error)}`)
  }
  return body.result
}

const { value: programDataAccount } = await rpc<{
  value: { data: [string, string] } | null
}>('getAccountInfo', [STAKE_PROGRAM_DATA, { encoding: 'base64' }])
if (!programDataAccount) {
  throw new Error(`stake ProgramData ${STAKE_PROGRAM_DATA} not found`)
}
const programData = Buffer.from(programDataAccount.data[0], 'base64')
// trailing zero bytes are part of the ELF, so the binary is everything after the header
const elf = programData.subarray(PROGRAM_DATA_HEADER)
const liveStake: Manifest = {
  cluster: 'mainnet-beta',
  programId: 'Stake11111111111111111111111111111111111111',
  programData: STAKE_PROGRAM_DATA,
  deploySlot: Number(programData.readBigUInt64LE(4)),
  size: elf.length,
  sha256: createHash('sha256').update(elf).digest('hex'),
}

const featureAccounts = await rpc<
  { pubkey: string; account: { data: [string, string] } }[]
>('getProgramAccounts', [FEATURE_PROGRAM, { encoding: 'base64' }])
const activated = featureAccounts
  .map(({ pubkey, account }) => {
    // Feature state is Option<u64>: the activation slot once the gate is on
    const data = Buffer.from(account.data[0], 'base64')
    return [pubkey, data[0] === 1 ? data.readBigUInt64LE(1) : null] as const
  })
  .filter(([, slot]) => slot !== null)
  .sort(([a], [b]) => a.localeCompare(b))
const liveFeatures: Features = {
  activated: Object.fromEntries(
    activated.map(([pubkey, slot]) => [pubkey, Number(slot)]),
  ),
}

if (process.argv.includes('--check')) {
  const drift: string[] = []
  const pinnedStake = JSON.parse(
    fs.readFileSync(MANIFEST_PATH, 'utf8'),
  ) as Manifest
  if (pinnedStake.sha256 !== liveStake.sha256) {
    drift.push(
      `stake program: fixture slot ${pinnedStake.deploySlot} ${pinnedStake.sha256}, ` +
        `mainnet slot ${liveStake.deploySlot} ${liveStake.sha256}`,
    )
  }
  const pinnedFeatures = JSON.parse(
    fs.readFileSync(FEATURES_PATH, 'utf8'),
  ) as Features
  for (const [feature, slot] of Object.entries(liveFeatures.activated)) {
    if (pinnedFeatures.activated[feature] !== slot) {
      drift.push(`feature ${feature} activated on mainnet at slot ${slot}`)
    }
  }
  for (const feature of Object.keys(pinnedFeatures.activated)) {
    if (!(feature in liveFeatures.activated)) {
      drift.push(`feature ${feature} is pinned but not active on mainnet`)
    }
  }
  if (drift.length === 0) {
    console.log(
      `mainnet fixture matches: stake program slot ${liveStake.deploySlot}, ` +
        `${activated.length} active features`,
    )
    process.exit(0)
  }
  console.error(
    drift.join('\n') +
      '\nrun `bun scripts/mainnet-fixture.ts` and re-run the LiteSVM tests',
  )
  process.exit(1)
}

fs.writeFileSync(ELF_PATH, elf)
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(liveStake, null, 2) + '\n')
fs.writeFileSync(FEATURES_PATH, JSON.stringify(liveFeatures, null, 2) + '\n')
console.log(`wrote ${FIXTURE_DIR}`, liveStake, `${activated.length} features`)
