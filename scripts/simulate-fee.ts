#!/usr/bin/env bun
/* eslint-disable n/no-process-exit */
// Simulates bid-distribution-cli across a range of epochs at multiple fee tiers.
// For each (epoch, fee) pair: patches settlement-config.yaml in a temp file, runs the CLI,
// and computes post-fee pmpe (adj = actual fees deducted, max = full fee applied uniformly).
// Fetches epoch timing from the SSR API to convert pmpe → APY.
// Downloads epoch input data via regression-test-settlements.sh if not already cached.
//
// Usage: bun scripts/simulate-fee.ts [-r] [-v] <epoch|start-end> <fees_bps>... [--data-dir DIR]

import { randomBytes } from 'node:crypto'
import { existsSync, unlinkSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

type Settlement = {
  reason: string
  details: {
    total_marinade_active_stake: number
    total_marinade_stakers_rewards: string
    marinade_fee_claim: number
    dao_fee_claim: number
  } | null
}

type BidDetails = NonNullable<Settlement['details']>

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    'data-dir': { type: 'string', default: './regression-data' },
    m: { type: 'string' },
    r: { type: 'boolean', default: false },
    v: { type: 'boolean', default: false },
  },
  allowPositionals: true,
})

const [epochArg, ...feeStrs] = positionals
let fees = feeStrs.map(Number)

if (fees.length === 0) {
  fees = [null]
}

if (!epochArg || fees.length === 0) {
  process.stderr.write(
    'usage: bun scripts/simulate-fee.ts [-r] [-v] <epoch|start-end> [-m <min_fee>] [<max_fee>]... [--data-dir DIR]\n',
  )
  process.exit(2)
}

const dataDir = values['data-dir']
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

const ssrRes = await fetch(`${apyUrl}/v1/epoch-pmpe/ssr`)
if (!ssrRes.ok) {
  process.stderr.write('Failed to fetch SSR\n')
  process.exit(1)
}
const ssrFeed = (await ssrRes.json()) as {
  epochs: { epoch: number; pmpe: number; time: number }[]
}

const INPUTS = [
  'stakes.json',
  'sam-scores.json',
  'validators.json',
  'evaluation.json',
  'rewards/mev.json',
  'rewards/validators_mev.json',
  'rewards/inflation.json',
  'rewards/validators_inflation.json',
  'rewards/validators_blocks.json',
  'rewards/jito_priority_fee.json',
]

const tmps: string[] = []
process.on('exit', () => {
  for (const t of tmps)
    try {
      unlinkSync(t)
    } catch {}
})
function mk() {
  const p = join('./tmp', `fee-${randomBytes(6).toString('hex')}.tmp`)
  tmps.push(p)
  return p
}

const cfgTemplate = await Bun.file('./settlement-config.yaml').text()
const cli = [
  'cargo',
  'run',
  '-q',
  ...(values.r ? ['--release'] : []),
  '--bin',
  'bid-distribution-cli',
  '--',
]
const apy = (p: number, n: number) =>
  ((Math.pow(1 + p / 1000, n) - 1) * 100).toFixed(2) + '%'
const sol = (v: number) => (Math.round((v / 1e9) * 1000) / 1000).toFixed(3)

console.log('epochs:')
for (let epoch = epochStart; epoch <= epochEnd; epoch++) {
  const inp = `${dataDir}/${epoch}/inputs`

  if (!INPUTS.every(f => existsSync(join(inp, f)))) {
    process.stderr.write(`  # fetching ${epoch}...\n`)
    Bun.spawnSync(
      [
        './scripts/regression-test-settlements.sh',
        '--start-epoch',
        String(epoch),
        '--end-epoch',
        String(epoch),
        '--data-dir',
        dataDir,
      ],
      { stderr: 'pipe' },
    )
    if (!INPUTS.every(f => existsSync(join(inp, f)))) {
      process.stderr.write(`  # fetch failed for ${epoch}, skipping\n`)
      continue
    }
  }

  const eData = ssrFeed.epochs.find(e => e.epoch === epoch)
  if (!eData) {
    process.stderr.write(`  # epoch ${epoch} not in SSR feed, skipping\n`)
    continue
  }
  const prev = ssrFeed.epochs.find(e => e.epoch === epoch - 1)
  const epy = prev ? 31557600 / (eData.time - prev.time) : 182

  console.log(`- epoch: ${epoch}`)
  console.log(`  ssr_pmpe: ${eData.pmpe}`)
  console.log(`  ssr_apy: ${apy(eData.pmpe, epy)}`)
  console.log(`  epochs_per_year: ${Math.floor(epy)}`)
  console.log('  simulations:')

  for (const fee of fees) {
    const cfg = mk(),
      out = mk()
    let cfgText = cfgTemplate
    if (fee != null)
      cfgText = cfgTemplate.replace(/(max_fee_bps:)\s*\d+/, `$1 ${fee}`)
    if (values.m !== undefined)
      cfgText = cfgText.replace(/(min_fee_bps:)\s*\d+/, `$1 ${values.m}`)
    const minFee = Number(cfgText.match(/min_fee_bps:\s*(\d+)/)?.[1] ?? 0)
    const maxFee = Number(cfgText.match(/max_fee_bps:\s*(\d+)/)?.[1] ?? 0)
    await writeFile(cfg, cfgText)

    const proc = Bun.spawnSync(
      [
        ...cli,
        '--settlement-config',
        cfg,
        '--stake-meta-collection',
        `${inp}/stakes.json`,
        '--sam-meta-collection',
        `${inp}/sam-scores.json`,
        '--rewards-dir',
        `${inp}/rewards`,
        '--validator-meta-collection',
        `${inp}/validators.json`,
        '--revenue-expectation-collection',
        `${inp}/evaluation.json`,
        '--output-settlement-collection',
        out,
        '--output-protected-event-collection',
        '/dev/null',
        '--apy-api-url',
        apyUrl,
      ],
      {
        env: {
          ...process.env,
          RUST_LOG: 'warn,bid_distribution::generators::bidding=info',
        },
        stderr: 'pipe',
      },
    )

    const stderr = Buffer.from(proc.stderr as Uint8Array).toString()
    for (const line of stderr.split('\n')) {
      if (line.includes(' ERROR ') || line.includes('Adjusted max_fee_bps'))
        process.stderr.write(line + '\n')
      else if (values.v && line.includes('SSR cap'))
        process.stderr.write(line + '\n')
    }
    if (proc.exitCode !== 0) {
      process.stderr.write(
        `  # cli failed (exit ${proc.exitCode}) for fee=${fee} epoch=${epoch}\n`,
      )
      continue
    }

    const { settlements } = (await Bun.file(out).json()) as {
      settlements: Settlement[]
    }
    const bids = settlements
      .filter(
        (s): s is Settlement & { details: BidDetails } =>
          s.reason === 'Bidding' && s.details !== null,
      )
      .map(s => s.details)
    if (!bids.length) {
      process.stderr.write(`  # no data for fee=${fee} epoch=${epoch}\n`)
      continue
    }

    const stake = bids.reduce((s, d) => s + d.total_marinade_active_stake, 0)
    const total = bids.reduce(
      (s, d) => s + parseFloat(d.total_marinade_stakers_rewards),
      0,
    )
    const feeAdj = settlements
      .filter(s => s.reason === 'Bidding' || s.reason === 'PriorityFee')
      .reduce(
        (s, e) =>
          s +
          (e.details?.marinade_fee_claim ?? 0) +
          (e.details?.dao_fee_claim ?? 0),
        0,
      )
    const pmpeAdj = ((total - feeAdj) / stake) * 1000
    const pmpeMax = ((total * (1 - maxFee / 10000)) / stake) * 1000
    const ncap = bids.filter(
      d =>
        parseFloat(d.total_marinade_stakers_rewards) > 0 &&
        d.marinade_fee_claim + d.dao_fee_claim <
          ((parseFloat(d.total_marinade_stakers_rewards) * maxFee) / 10000) *
            0.9999,
    ).length
    const nmin = bids.filter(
      d =>
        parseFloat(d.total_marinade_stakers_rewards) > 0 &&
        d.marinade_fee_claim + d.dao_fee_claim <=
          ((parseFloat(d.total_marinade_stakers_rewards) * minFee) / 10000) *
            1.0001,
    ).length

    console.log(`  - max_fee_bps: ${maxFee}`)
    console.log(`    min_fee_bps: ${minFee}`)
    console.log(`    post_fee_pmpe_adj: ${pmpeAdj.toFixed(6)}`)
    console.log(`    post_fee_pmpe_max: ${pmpeMax.toFixed(6)}`)
    console.log(`    apy_adj: ${apy(pmpeAdj, epy)}`)
    console.log(`    apy_max: ${apy(pmpeMax, epy)}`)
    console.log(`    fee_sol_adj: ${sol(feeAdj)}`)
    console.log(`    fee_sol_max: ${sol((total * maxFee) / 10000)}`)
    console.log(`    validators_capped: ${ncap}/${bids.length}`)
    console.log(`    validators_at_min_fee: ${nmin}/${bids.length}`)
  }
}
