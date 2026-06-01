#!/usr/bin/env bun
/* eslint-disable n/no-process-exit */
// Per stake-size bucket of individual stakers, prints (as YAML, one epoch per file from
// tmp/settlements-<epoch>.json) their net staking yield and the fee Marinade extracts.
//
//   active stakers    -> binned by active_stake; yield = (inflation+mev+block+static_bid - fee)
//                        per active SOL, from the Bidding settlement. Excludes the activating bid.
//   activating stakers-> binned by activating_stake; yield = activating_stakers_pool per
//                        activating SOL, from the PriorityFee settlement. That activating bid is
//                        also inside the Bidding gross, so it is counted here, not there.
//   PSR / penalties   -> extra claim_amount paid to stakers on top (no new stake).
//   pool              -> marinade stake (active or activating) with no per-staker claim -- the
//                        mSOL liquid pool, whose rewards reach mSOL holders off-settlement. Own row.
//   fee               -> mDAo../BBaQ.. claims (distributor fee), attributed at the same per-SOL rate.
//
// total_marinade_stakers_rewards includes the on-chain inflation/MEV, so yield_apy is the full
// staking APY (~7%), not just settlement-delivered lamports. EPOCHS_PER_YEAR is nominal.
//
// Usage: bun scripts/individual-apy-report.ts <epoch|start-end>

import { existsSync } from 'node:fs'
import { join } from 'node:path'

type Claim = {
  withdraw_authority: string
  stake_authority: string
  active_stake: number
  activating_stake: number
  claim_amount: number
}
type Details = {
  total_marinade_active_stake?: number
  total_marinade_stakers_rewards?: string
  staker_inflation_rewards?: string
  staker_mev_rewards?: string
  staker_block_rewards?: string
  staker_bid_rewards?: string
  total_marinade_activating_stake?: number
  activating_stakers_pool?: number
}
type Settlement = {
  reason: string | object
  vote_account?: string
  claims: Claim[]
  details?: Details | null
}
type Acc = { stake: number; yield: number; fee: number }

const DIR = 'tmp'
const EDGES = [10, 100, 1000, 10000]
const EPOCHS_PER_YEAR = 182
const FEE_AUTHORITIES = new Set([
  'mDAo14E6YJfEHcVZLcc235RVjviypmKMhftq7jeiLJz',
  'BBaQsiRo744NAYaqL3nKRfgeJayoqVicEQsEnLpfsJ6x',
])

const epochArg = process.argv[2]
if (!epochArg) {
  process.stderr.write(
    'usage: bun scripts/individual-apy-report.ts <epoch|start-end>\n',
  )
  process.exit(2)
}
const [epochStart, epochEnd] = epochArg.includes('-')
  ? epochArg.split('-').map(Number)
  : [Number(epochArg), Number(epochArg)]

const sol = (lamports: number) => (lamports / 1e9).toFixed(3)
const apy = (pmpe: number) =>
  ((Math.pow(1 + pmpe / 1000, EPOCHS_PER_YEAR) - 1) * 100).toFixed(2) + '%'
const pmpe = (amount: number, stake: number) =>
  stake > 0 ? (amount / stake) * 1000 : 0
const num = (s?: string) => parseFloat(s ?? '0')
const isFee = (c: Claim) => FEE_AUTHORITIES.has(c.stake_authority)
const label = (i: number) =>
  i < EDGES.length
    ? `< ${EDGES[i].toLocaleString()} SOL`
    : `>= ${EDGES.at(-1)?.toLocaleString()} SOL`

function binOf(stakeSol: number) {
  for (let i = 0; i < EDGES.length; i++) if (stakeSol < EDGES[i]) return i
  return EDGES.length
}

const row = (name: string, n: number, b: Acc) => {
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
  const path = join(DIR, `settlements-${epoch}.json`)
  if (!existsSync(path)) {
    process.stderr.write(`  # no distribution for ${epoch}, skipping\n`)
    continue
  }
  const { settlements } = (await Bun.file(path).json()) as {
    settlements: Settlement[]
  }

  const stakers = new Map<string, Acc>()
  const pool: Acc = { stake: 0, yield: 0, fee: 0 }
  let feeTotal = 0
  let legacy = false
  const get = (wa: string) => {
    let w = stakers.get(wa)
    if (!w) stakers.set(wa, (w = { stake: 0, yield: 0, fee: 0 }))
    return w
  }

  for (const s of settlements) {
    const fee = s.claims.filter(isFee).reduce((a, c) => a + c.claim_amount, 0)
    feeTotal += fee
    const d = s.details

    if (s.reason === 'Bidding') {
      const mstake = d?.total_marinade_active_stake ?? 0
      if (mstake <= 0) {
        legacy = true
        continue
      }
      // active-only gross: the activating bid lives in PriorityFee, count it there not here.
      const gross =
        d?.staker_inflation_rewards != null
          ? num(d.staker_inflation_rewards) +
            num(d.staker_mev_rewards) +
            num(d.staker_block_rewards) +
            num(d.staker_bid_rewards)
          : num(d?.total_marinade_stakers_rewards)
      const yieldRate = (gross - fee) / mstake
      const feeRate = fee / mstake
      let indiv = 0
      for (const c of s.claims) {
        if (isFee(c) || c.active_stake <= 0) continue
        const w = get(c.withdraw_authority)
        w.stake += c.active_stake
        w.yield += c.active_stake * yieldRate
        w.fee += c.active_stake * feeRate
        indiv += c.active_stake
      }
      const ps = Math.max(0, mstake - indiv)
      pool.stake += ps
      pool.yield += ps * yieldRate
      pool.fee += ps * feeRate
      if (indiv > mstake)
        process.stderr.write(
          `  # epoch ${epoch}: WARN active stake exceeds marinade total at ${s.vote_account}\n`,
        )
    } else if (s.reason === 'PriorityFee') {
      const astake = d?.total_marinade_activating_stake ?? 0
      if (astake <= 0) continue
      const yieldRate = (d?.activating_stakers_pool ?? 0) / astake
      const feeRate = fee / astake
      let indiv = 0
      for (const c of s.claims) {
        if (isFee(c) || c.activating_stake <= 0) continue
        const w = get(c.withdraw_authority)
        w.stake += c.activating_stake
        w.yield += c.activating_stake * yieldRate
        w.fee += c.activating_stake * feeRate
        indiv += c.activating_stake
      }
      const ps = Math.max(0, astake - indiv)
      pool.stake += ps
      pool.yield += ps * yieldRate
      pool.fee += ps * feeRate
    } else {
      // PSR / penalties: extra SOL on top; their active stake is already counted in Bidding.
      for (const c of s.claims) {
        if (isFee(c)) continue
        get(c.withdraw_authority).yield += c.claim_amount
      }
    }
  }

  const dropped = [...stakers.values()].filter(
    w => w.stake === 0 && w.yield > 0,
  )
  if (dropped.length)
    process.stderr.write(
      `  # epoch ${epoch}: dropped ${dropped.length} stakers with yield but no stake (${sol(dropped.reduce((a, w) => a + w.yield, 0))} SOL)\n`,
    )
  const counted = [...stakers.values()].filter(w => w.stake > 0)
  if (!counted.length) {
    process.stderr.write(
      legacy
        ? `  # epoch ${epoch}: legacy format (no Bidding details), skipping\n`
        : `  # no individual stakers for ${epoch}, skipping\n`,
    )
    continue
  }

  const bins = EDGES.concat(Infinity).map(() => ({
    n: 0,
    stake: 0,
    yield: 0,
    fee: 0,
  }))
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
