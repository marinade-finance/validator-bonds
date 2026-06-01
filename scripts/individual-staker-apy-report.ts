#!/usr/bin/env bun
/* eslint-disable n/no-process-exit */
// Loads old bid-distribution result collections (tmp/settlements-<epoch>.json) and reports
// how the realized per-epoch yield differs across individual stakers, binned by total stake.
// Claims are aggregated per withdraw_authority (a withdrawer's stake may span many validators);
// their yield is Σclaim_amount / Σactive_stake. The single biggest withdrawer is the mSOL
// liquid-staking pool -- it is split out and reported apart so it does not dominate the bins.
// Per bin we report the stake-weighted pmpe (= Σclaim/Σstake * 1000, as simulate-fee) as APY
// via SSR epoch timing.
//
// Usage: bun scripts/individual-staker-apy-report.ts <epoch|start-end> [--data-dir DIR] [--bins 10,100,1000,10000]

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

type Claim = {
  withdraw_authority: string
  active_stake: number
  claim_amount: number
}
type Settlement = { reason: string | Record<string, unknown>; claims: Claim[] }
type Collection = { epoch: number; settlements: Settlement[] }

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    'data-dir': { type: 'string', default: './tmp' },
    bins: { type: 'string', default: '10,100,1000,10000' },
  },
  allowPositionals: true,
})

const [epochArg] = positionals
if (!epochArg) {
  process.stderr.write(
    'usage: bun scripts/individual-staker-apy-report.ts <epoch|start-end> [--data-dir DIR] [--bins 10,100,1000,10000]\n',
  )
  process.exit(2)
}

const dataDir = values['data-dir']
const edges = values.bins.split(',').map(Number)
const apyUrl = process.env.APY_API_URL ?? 'https://apy.marinade.finance'
const [epochStart, epochEnd] = epochArg.includes('-')
  ? epochArg.split('-').map(Number)
  : [Number(epochArg), Number(epochArg)]
if (
  !Number.isInteger(epochStart) ||
  !Number.isInteger(epochEnd) ||
  epochStart > epochEnd
) {
  process.stderr.write('Failed: invalid epoch range\n')
  process.exit(2)
}

// SSR feed gives epoch timing (epochs-per-year) and a reference pmpe to compare bins against.
// Best-effort: if the network is unavailable, fall back to a nominal 182 epochs/year.
type SsrEpoch = { epoch: number; pmpe: number; time: number }
let ssrEpochs: SsrEpoch[] = []
try {
  const res = await fetch(`${apyUrl}/v1/epoch-pmpe/ssr`)
  if (res.ok) ssrEpochs = ((await res.json()) as { epochs: SsrEpoch[] }).epochs
  else
    process.stderr.write('  # SSR feed unavailable, APY uses 182 epochs/year\n')
} catch {
  process.stderr.write('  # SSR feed unreachable, APY uses 182 epochs/year\n')
}

const apy = (pmpe: number, n: number) =>
  ((Math.pow(1 + pmpe / 1000, n) - 1) * 100).toFixed(2) + '%'
const sol = (lamports: number) =>
  (Math.round((lamports / 1e9) * 1000) / 1000).toFixed(3)
const label = (i: number) =>
  i < edges.length
    ? `<=${edges[i].toLocaleString()} SOL`
    : `>${edges.at(-1)?.toLocaleString()} SOL`

function binIndex(stakeSol: number) {
  for (let i = 0; i < edges.length; i++) if (stakeSol < edges[i]) return i
  return edges.length
}

console.log('epochs:')
for (let epoch = epochStart; epoch <= epochEnd; epoch++) {
  const path = join(dataDir, `settlements-${epoch}.json`)
  if (!existsSync(path)) {
    process.stderr.write(
      `  # no distribution for ${epoch} at ${path}, skipping\n`,
    )
    continue
  }

  const { settlements } = (await Bun.file(path).json()) as Collection
  const claims = settlements
    .filter(s => s.reason === 'Bidding')
    .flatMap(s => s.claims)
    .filter(c => c.active_stake > 0)
  if (!claims.length) {
    process.stderr.write(`  # no Bidding claims for ${epoch}, skipping\n`)
    continue
  }

  // A withdrawer's stake spans many validators -> aggregate all their claims into one position.
  const byWithdrawer = new Map<string, { stake: number; claim: number }>()
  for (const c of claims) {
    const w = byWithdrawer.get(c.withdraw_authority) ?? { stake: 0, claim: 0 }
    w.stake += c.active_stake
    w.claim += c.claim_amount
    byWithdrawer.set(c.withdraw_authority, w)
  }
  // The biggest withdrawer is the mSOL pool; split it off so bins reflect individual stakers.
  const ranked = [...byWithdrawer.entries()].sort(
    (a, b) => b[1].stake - a[1].stake,
  )
  const first = ranked.at(0)
  if (!first) continue
  const [poolKey, pool] = first
  const withdrawers = ranked.slice(1).map(([, w]) => w)

  const ssr = ssrEpochs.find(e => e.epoch === epoch)
  const prev = ssrEpochs.find(e => e.epoch === epoch - 1)
  const epy = ssr && prev ? 31557600 / (ssr.time - prev.time) : 182

  // Each bin accumulates Σstake and Σclaim so pmpe = Σclaim / Σstake * 1000 (stake-weighted).
  const bins = Array.from({ length: edges.length + 1 }, () => ({
    n: 0,
    stake: 0,
    claim: 0,
  }))
  for (const w of withdrawers) {
    const b = bins[binIndex(w.stake / 1e9)]
    b.n++
    b.stake += w.stake
    b.claim += w.claim
  }

  const totStake = withdrawers.reduce((s, w) => s + w.stake, 0)
  const totClaim = withdrawers.reduce((s, w) => s + w.claim, 0)
  const overallPmpe = (totClaim / totStake) * 1000

  console.log(`- epoch: ${epoch}`)
  console.log(`  epochs_per_year: ${Math.floor(epy)}`)
  if (ssr) {
    console.log(`  ssr_pmpe: ${ssr.pmpe}`)
    console.log(`  ssr_apy: ${apy(ssr.pmpe, epy)}`)
  }
  const poolPmpe = (pool.claim / pool.stake) * 1000
  console.log('  msol_pool:')
  console.log(`    withdraw_authority: ${poolKey}`)
  console.log(`    stake_sol: ${sol(pool.stake)}`)
  console.log(`    pmpe: ${poolPmpe.toFixed(6)}`)
  console.log(`    apy: ${apy(poolPmpe, epy)}`)
  console.log(`  withdrawers: ${withdrawers.length}`)
  console.log(`  total_stake_sol: ${sol(totStake)}`)
  console.log(`  overall_pmpe: ${overallPmpe.toFixed(6)}`)
  console.log(`  overall_apy: ${apy(overallPmpe, epy)}`)
  console.log('  bins:')
  for (let i = 0; i < bins.length; i++) {
    const b = bins[i]
    if (b.n === 0) continue
    const pmpe = (b.claim / b.stake) * 1000
    console.log(`  - range: ${label(i)}`)
    console.log(`    withdrawers: ${b.n}`)
    console.log(`    stake_sol: ${sol(b.stake)}`)
    console.log(`    reward_sol: ${sol(b.claim)}`)
    console.log(`    pmpe: ${pmpe.toFixed(6)}`)
    console.log(`    apy: ${apy(pmpe, epy)}`)
    console.log(`    vs_overall: ${(pmpe / overallPmpe).toFixed(2)}x`)
  }
}
