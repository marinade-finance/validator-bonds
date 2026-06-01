#!/usr/bin/env bun
/* eslint-disable n/no-process-exit */
// Reports how much fee Marinade extracts from individual stakers, per stake-size bucket, from old
// bid-distribution result files (tmp/settlements-<epoch>.json).
//
// mDAo.. (DAO) and BBaQ.. (Marinade) are fee recipients, not stakers: their claim_amount is the
// dao/marinade fee (see bid-distribution/README, settlement-config.yaml). We drop them from the
// staker set and sum their claims as fees. Per validator the fee rate is uniform per SOL
// (fee / total_marinade_active_stake), so a staker's fee is their stake * that rate.
//
// Usage: bun scripts/individual-staker-apy-report.ts <epoch|start-end> [--data-dir DIR] [--bins 10,100,1000,10000]

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

type Claim = {
  withdraw_authority: string
  stake_authority: string
  active_stake: number
  claim_amount: number
}
type Settlement = {
  reason: string
  claims: Claim[]
  details?: { total_marinade_active_stake?: number } | null
}

const FEE_AUTHORITIES = new Set([
  'mDAo14E6YJfEHcVZLcc235RVjviypmKMhftq7jeiLJz',
  'BBaQsiRo744NAYaqL3nKRfgeJayoqVicEQsEnLpfsJ6x',
])
const EPOCHS_PER_YEAR = 182

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

const edges = values.bins.split(',').map(Number)
const [epochStart, epochEnd] = epochArg.includes('-')
  ? epochArg.split('-').map(Number)
  : [Number(epochArg), Number(epochArg)]

const sol = (lamports: number) => (lamports / 1e9).toFixed(3)
const apy = (pmpe: number) =>
  ((Math.pow(1 + pmpe / 1000, EPOCHS_PER_YEAR) - 1) * 100).toFixed(2) + '%'
const label = (i: number) =>
  i < edges.length
    ? `<=${edges[i].toLocaleString()} SOL`
    : `>${edges.at(-1)?.toLocaleString()} SOL`

function binOf(stakeSol: number) {
  for (let i = 0; i < edges.length; i++) if (stakeSol < edges[i]) return i
  return edges.length
}

console.log('epochs:')
for (let epoch = epochStart; epoch <= epochEnd; epoch++) {
  const path = join('.', values['data-dir'], `settlements-${epoch}.json`)
  if (!existsSync(path)) {
    process.stderr.write(`  # no distribution for ${epoch}, skipping\n`)
    continue
  }
  const { settlements } = (await Bun.file(path).json()) as {
    settlements: Settlement[]
  }

  // Per staker: total stake, and fee attributed at each validator's per-SOL rate.
  const stakers = new Map<string, { stake: number; fee: number }>()
  let feeTotal = 0
  for (const s of settlements) {
    if (s.reason !== 'Bidding') continue
    const feeClaims = s.claims.filter(c =>
      FEE_AUTHORITIES.has(c.stake_authority),
    )
    const fee = feeClaims.reduce((a, c) => a + c.claim_amount, 0)
    feeTotal += fee
    const marinadeStake =
      s.details?.total_marinade_active_stake ?? feeClaims[0]?.active_stake ?? 0
    const rate = marinadeStake > 0 ? fee / marinadeStake : 0
    for (const c of s.claims) {
      if (c.active_stake <= 0 || FEE_AUTHORITIES.has(c.stake_authority))
        continue
      const w = stakers.get(c.withdraw_authority) ?? { stake: 0, fee: 0 }
      w.stake += c.active_stake
      w.fee += c.active_stake * rate
      stakers.set(c.withdraw_authority, w)
    }
  }
  if (stakers.size === 0) {
    process.stderr.write(`  # no individual stakers for ${epoch}, skipping\n`)
    continue
  }

  const bins = edges.concat(Infinity).map(() => ({ n: 0, stake: 0, fee: 0 }))
  for (const w of stakers.values()) {
    const b = bins[binOf(w.stake / 1e9)]
    b.n++
    b.stake += w.stake
    b.fee += w.fee
  }
  const stake = bins.reduce((a, b) => a + b.stake, 0)
  const fee = bins.reduce((a, b) => a + b.fee, 0)
  const feePmpe = (fee / stake) * 1000

  console.log(`- epoch: ${epoch}`)
  console.log(`  fee_total_sol: ${sol(feeTotal)}`)
  console.log(`  stakers: ${stakers.size}`)
  console.log(`  stake_sol: ${sol(stake)}`)
  console.log(`  fee_sol: ${sol(fee)}`)
  console.log(`  fee_pmpe: ${feePmpe.toFixed(6)}`)
  console.log(`  fee_apy: ${apy(feePmpe)}`)
  console.log('  bins:')
  for (let i = 0; i < bins.length; i++) {
    const b = bins[i]
    if (b.n === 0) continue
    const pmpe = (b.fee / b.stake) * 1000
    console.log(`  - range: ${label(i)}`)
    console.log(`    stakers: ${b.n}`)
    console.log(`    stake_sol: ${sol(b.stake)}`)
    console.log(`    fee_sol: ${sol(b.fee)}`)
    console.log(`    fee_pmpe: ${pmpe.toFixed(6)}`)
    console.log(`    fee_apy: ${apy(pmpe)}`)
    console.log(`    vs_overall: ${(pmpe / feePmpe).toFixed(2)}x`)
  }
}
