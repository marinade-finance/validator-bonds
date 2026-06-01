#!/usr/bin/env bun
/* eslint-disable n/no-process-exit */
// Per stake-size bucket of individual stakers, reports the settlement yield they receive and the
// fee Marinade extracts -- across ALL settlement types (bids, PSR/protected events, penalties,
// priority fees), from old result files (tmp/settlements-<epoch>.json).
//
//   yield = SUM of every claim_amount a staker receives (bid + PSR + penalties + priority), net
//           of fee. NOTE: this is the bonds-system yield only -- base inflation/MEV is paid
//           on-chain to the stake account and is NOT in these files, so it is not total staking
//           APY. Settlement pmpe (~0.02) is a fraction of SSR pmpe (~0.36).
//   fee   = mDAo.. (DAO) / BBaQ.. (Marinade) claims, the distributor fee. Per validator the fee
//           rate is uniform per SOL (fee / total_marinade_active_stake); a staker's fee is their
//           stake * that rate. fee_apy is that rate annualized on stake, not fee-as-%-of-reward.
//   stake = taken from Bidding only (it covers all active stake); other settlement types reuse
//           the same stake, so summing across them would double-count.
//
// Usage: bun scripts/individual-apy-report.ts <epoch|start-end> [--data-dir DIR] [--bins 10,100,1000,10000]

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
  reason: string | object
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
    'usage: bun scripts/individual-apy-report.ts <epoch|start-end> [--data-dir DIR] [--bins 10,100,1000,10000]\n',
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
const pmpe = (claim: number, stake: number) =>
  stake > 0 ? (claim / stake) * 1000 : 0
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

  // Per staker: stake (from Bidding), total yield received (all types), and attributed fee.
  const stakers = new Map<
    string,
    { stake: number; yield: number; fee: number }
  >()
  let feeTotal = 0
  for (const s of settlements) {
    const fee = s.claims
      .filter(c => FEE_AUTHORITIES.has(c.stake_authority))
      .reduce((a, c) => a + c.claim_amount, 0)
    feeTotal += fee
    const denom = s.details?.total_marinade_active_stake ?? 0
    const rate = denom > 0 ? fee / denom : 0
    const isBidding = s.reason === 'Bidding'
    for (const c of s.claims) {
      if (FEE_AUTHORITIES.has(c.stake_authority)) continue
      const w = stakers.get(c.withdraw_authority) ?? {
        stake: 0,
        yield: 0,
        fee: 0,
      }
      w.yield += c.claim_amount
      w.fee += c.active_stake * rate
      if (isBidding) w.stake += c.active_stake
      stakers.set(c.withdraw_authority, w)
    }
  }
  const counted = [...stakers.values()].filter(w => w.stake > 0)
  if (!counted.length) {
    process.stderr.write(`  # no individual stakers for ${epoch}, skipping\n`)
    continue
  }

  const bins = edges
    .concat(Infinity)
    .map(() => ({ n: 0, stake: 0, yield: 0, fee: 0 }))
  for (const w of counted) {
    const b = bins[binOf(w.stake / 1e9)]
    b.n++
    b.stake += w.stake
    b.yield += w.yield
    b.fee += w.fee
  }
  const stake = bins.reduce((a, b) => a + b.stake, 0)
  const yld = bins.reduce((a, b) => a + b.yield, 0)
  const fee = bins.reduce((a, b) => a + b.fee, 0)

  console.log(`- epoch: ${epoch}`)
  console.log(`  stakers: ${counted.length}`)
  console.log(`  stake_sol: ${sol(stake)}`)
  console.log(`  yield_sol: ${sol(yld)}`)
  console.log(`  yield_apy: ${apy(pmpe(yld, stake))}`)
  console.log(`  fee_sol: ${sol(fee)}`)
  console.log(`  fee_apy: ${apy(pmpe(fee, stake))}`)
  console.log(`  fee_total_sol: ${sol(feeTotal)}`)
  console.log('  bins:')
  for (let i = 0; i < bins.length; i++) {
    const b = bins[i]
    if (b.n === 0) continue
    console.log(`  - range: ${label(i)}`)
    console.log(`    stakers: ${b.n}`)
    console.log(`    stake_sol: ${sol(b.stake)}`)
    console.log(`    yield_sol: ${sol(b.yield)}`)
    console.log(`    yield_apy: ${apy(pmpe(b.yield, b.stake))}`)
    console.log(`    fee_sol: ${sol(b.fee)}`)
    console.log(`    fee_apy: ${apy(pmpe(b.fee, b.stake))}`)
  }
}
