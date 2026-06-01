#!/usr/bin/env bun
/* eslint-disable n/no-process-exit */
// Per stake-size bucket of individual stakers, reports their net staking yield and the fee
// Marinade extracts -- from old result files (tmp/settlements-<epoch>.json).
//
//   yield = net staker reward. A Bidding settlement's details carry total_marinade_stakers_rewards
//           (the full inflation+MEV+block+bid reward, net of validator commission) over
//           total_marinade_active_stake -- a uniform per-SOL rate. A staker's yield is their stake
//           * (reward - fee) / total_marinade_active_stake, plus any PSR / penalty / priority
//           claim_amount paid on top.
//   fee   = mDAo.. (DAO) / BBaQ.. (Marinade) claims, the distributor fee, at the same per-SOL
//           rate. yield + fee = gross reward; fee_apy is the fee annualized on stake.
//   pool  = marinade stake not held by individual stakers (the mSOL/DAO pool), shown as its own
//           category so the fee column accounts for Marinade's full take.
//   stake = from Bidding (it covers all active stake); other settlement types reuse the same
//           stake, so summing across them would double-count.
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
  vote_account?: string
  claims: Claim[]
  details?: {
    total_marinade_active_stake?: number
    total_marinade_stakers_rewards?: string
  } | null
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
const pmpe = (amount: number, stake: number) =>
  stake > 0 ? (amount / stake) * 1000 : 0
const label = (i: number) =>
  i < edges.length
    ? `< ${edges[i].toLocaleString()} SOL`
    : `>= ${edges.at(-1)?.toLocaleString()} SOL`

function binOf(stakeSol: number) {
  for (let i = 0; i < edges.length; i++) if (stakeSol < edges[i]) return i
  return edges.length
}

const row = (
  name: string,
  n: number,
  b: { stake: number; yield: number; fee: number },
) => {
  console.log(`  - ${name}`)
  console.log(`    stakers: ${n}`)
  console.log(`    stake_sol: ${sol(b.stake)}`)
  console.log(`    yield_sol: ${sol(b.yield)}`)
  console.log(`    yield_apy: ${apy(pmpe(b.yield, b.stake))}`)
  console.log(`    fee_sol: ${sol(b.fee)}`)
  console.log(`    fee_apy: ${apy(pmpe(b.fee, b.stake))}`)
}

console.log('epochs:')
for (let epoch = epochStart; epoch <= epochEnd; epoch++) {
  const path = join(values['data-dir'], `settlements-${epoch}.json`)
  if (!existsSync(path)) {
    process.stderr.write(`  # no distribution for ${epoch}, skipping\n`)
    continue
  }
  const { settlements } = (await Bun.file(path).json()) as {
    settlements: Settlement[]
  }

  const stakers = new Map<
    string,
    { stake: number; yield: number; fee: number }
  >()
  const pool = { stake: 0, yield: 0, fee: 0 }
  let feeTotal = 0
  let legacy = false
  for (const s of settlements) {
    const feeSum = s.claims
      .filter(c => FEE_AUTHORITIES.has(c.stake_authority))
      .reduce((a, c) => a + c.claim_amount, 0)
    feeTotal += feeSum
    const mstake = s.details?.total_marinade_active_stake ?? 0
    if (s.reason === 'Bidding' && mstake <= 0) {
      legacy = true
      continue
    }
    if (s.reason === 'Bidding') {
      // Uniform per-SOL rate from validator totals; split into stakers' net yield and the fee.
      const gross = parseFloat(s.details?.total_marinade_stakers_rewards ?? '0')
      const yieldRate = (gross - feeSum) / mstake
      const feeRate = feeSum / mstake
      let indiv = 0
      for (const c of s.claims) {
        if (FEE_AUTHORITIES.has(c.stake_authority)) continue
        const w = stakers.get(c.withdraw_authority) ?? {
          stake: 0,
          yield: 0,
          fee: 0,
        }
        w.stake += c.active_stake
        w.yield += c.active_stake * yieldRate
        w.fee += c.active_stake * feeRate
        stakers.set(c.withdraw_authority, w)
        indiv += c.active_stake
      }
      if (indiv > mstake) {
        process.stderr.write(
          `  # epoch ${epoch}: WARN individual stake exceeds marinade total at ${s.vote_account}\n`,
        )
      }
      const ps = Math.max(0, mstake - indiv)
      pool.stake += ps
      pool.yield += ps * yieldRate
      pool.fee += ps * feeRate
    } else {
      // PSR / penalties: extra SOL paid to stakers on top of the bid reward.
      // PriorityFee pays the activating bid that is already in the Bidding gross -- skip it.
      if (s.reason === 'PriorityFee') continue
      for (const c of s.claims) {
        if (FEE_AUTHORITIES.has(c.stake_authority)) continue
        const w = stakers.get(c.withdraw_authority) ?? {
          stake: 0,
          yield: 0,
          fee: 0,
        }
        w.yield += c.claim_amount
        stakers.set(c.withdraw_authority, w)
      }
    }
  }
  const dropped = [...stakers.values()].filter(
    w => w.stake === 0 && w.yield > 0,
  )
  if (dropped.length) {
    const sum = dropped.reduce((a, w) => a + w.yield, 0)
    process.stderr.write(
      `  # epoch ${epoch}: dropped ${dropped.length} stakers with yield but no active stake (${sol(sum)} SOL)\n`,
    )
  }
  const counted = [...stakers.values()].filter(w => w.stake > 0)
  if (!counted.length) {
    if (legacy) {
      process.stderr.write(
        `  # epoch ${epoch}: legacy format (no Bidding details), skipping\n`,
      )
    } else {
      process.stderr.write(`  # no individual stakers for ${epoch}, skipping\n`)
    }
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
  const all = counted.reduce(
    (a, w) => ({
      stake: a.stake + w.stake,
      yield: a.yield + w.yield,
      fee: a.fee + w.fee,
    }),
    { stake: 0, yield: 0, fee: 0 },
  )

  console.log(`- epoch: ${epoch}`)
  console.log(`  stakers: ${counted.length}`)
  console.log(`  stake_sol: ${sol(all.stake)}`)
  console.log(`  yield_apy: ${apy(pmpe(all.yield, all.stake))}`)
  console.log(`  fee_sol: ${sol(all.fee)}`)
  console.log(`  fee_total_sol: ${sol(feeTotal)}`)
  console.log(`  other_fee_sol: ${sol(feeTotal - (all.fee + pool.fee))}`)
  console.log('  bins:')
  for (let i = 0; i < bins.length; i++) {
    if (bins[i].n > 0) row(`range: ${label(i)}`, bins[i].n, bins[i])
  }
  if (pool.stake > 0) row('range: pool (mSOL/DAO)', 1, pool)
}
