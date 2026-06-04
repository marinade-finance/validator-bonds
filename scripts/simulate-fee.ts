#!/usr/bin/env bun
/* eslint-disable n/no-process-exit */
import { randomBytes } from 'node:crypto'
import { existsSync, unlinkSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

// eslint-disable-next-line import/no-extraneous-dependencies
import { parse as parseYaml } from 'yaml'

import {
  type Settlement,
  type BidSettlement,
  isProtectedEvent,
  sumStakerExtras,
  feesByVoteAccount,
} from './settlement-utils'

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    'data-dir': {
      type: 'string',
      default: process.env.DATA_DIR ?? './regression-data',
    },
    d: { type: 'string' },
    c: { type: 'boolean', default: false },
    m: { type: 'string' },
    r: { type: 'boolean', default: false },
    v: { type: 'boolean', default: false },
  },
  allowPositionals: true,
})

const [epochArg, ...feeStrs] = positionals
const fees: (number | null)[] = feeStrs.length ? feeStrs.map(Number) : [null]

if (values.c && feeStrs.length) {
  process.stderr.write(
    'Failed: fee arguments are ignored in -c mode (production settlement already has fees baked in)\n',
  )
  process.exit(2)
}
if (values.c && values.m !== undefined) {
  process.stderr.write(
    'Failed: -m is ignored in -c mode (production settlement already has fees baked in)\n',
  )
  process.exit(2)
}

if (!epochArg) {
  process.stderr.write(
    'Simulates bid-distribution-cli across a range of epochs at multiple fee tiers.\n' +
      'Patches settlement-config.yaml per (epoch, fee) pair, runs the CLI, and computes\n' +
      'post-fee pmpe (adj = actual fees deducted, max = uniform max fee).\n' +
      'Fetches SSR timing from apy-api to convert pmpe → APY.\n' +
      '\n' +
      'usage: bun scripts/simulate-fee.ts [-r] [-v] [-c] [-d DIR] <epoch|start-end> [-m <min_fee>] [<max_fee>]...\n' +
      '  -d DIR  data dir (default: $DATA_DIR or ./regression-data)\n' +
      '  -c      read production settlement from GCS instead of re-running CLI\n',
  )
  process.exit(2)
}

const dataDir = values.d ?? values['data-dir']
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
const ssr = (await ssrRes.json()) as {
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
function tmpFile() {
  const p = join('./tmp', `fee-${randomBytes(6).toString('hex')}.tmp`)
  tmps.push(p)
  return p
}

const cfgTemplate = await Bun.file('./settlement-config.yaml').text()

type BidConfig = {
  whitelist_stake_authorities?: string[]
  exiting_stake_authorities?: string[]
  fee_config: { min_fee_bps: number; max_fee_bps: number }
}

function loadConfig(yaml: string): BidConfig {
  return parseYaml(yaml) as BidConfig
}

async function redelegationStakeFromFile(
  stakesPath: string,
  cfg: BidConfig,
): Promise<number> {
  const { stake_metas: metas } = (await Bun.file(stakesPath).json()) as {
    stake_metas: {
      stake_authority: string
      deactivating_delegation_lamports: string | number
    }[]
  }
  const whitelist = new Set(cfg.whitelist_stake_authorities ?? [])
  const exiting = new Set(cfg.exiting_stake_authorities ?? [])
  return metas.reduce(
    (sum, m) =>
      whitelist.has(m.stake_authority) && !exiting.has(m.stake_authority)
        ? sum + parseFloat(String(m.deactivating_delegation_lamports))
        : sum,
    0,
  )
}

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

const GCS_BONDS = 'gs://marinade-validator-bonds-mainnet'
const PROD_FILE = 'bid-distribution-settlements.json'

function runMkdir(dir: string) {
  Bun.spawnSync(['mkdir', '-p', dir], { stderr: 'pipe' })
}

function runGcsCp(src: string, dst: string) {
  Bun.spawnSync(['gcloud', 'storage', 'cp', src, dst], { stderr: 'pipe' })
}

function fetchProductionSettlement(epoch: number): string {
  const dir = join(dataDir, String(epoch))
  const path = join(dir, PROD_FILE)
  if (!existsSync(path)) {
    process.stderr.write(`  # downloading ${PROD_FILE} for epoch ${epoch}...\n`)
    runMkdir(dir)
    runGcsCp(`${GCS_BONDS}/${epoch}/${PROD_FILE}`, path)
  }
  if (!existsSync(path)) {
    process.stderr.write(`Failed: ${PROD_FILE} not found for epoch ${epoch}\n`)
    process.exit(1)
  }
  return path
}

function fetchInputs(epoch: number): void {
  const inp = join(dataDir, String(epoch), 'inputs')
  if (INPUTS.every(f => existsSync(join(inp, f)))) return
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
    process.stderr.write(`Failed: fetch failed for epoch ${epoch}\n`)
    process.exit(1)
  }
}

function runCli(cfgFile: string, inp: string): string {
  const out = tmpFile()
  const proc = Bun.spawnSync(
    [
      ...cli,
      '--settlement-config',
      cfgFile,
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
  const stderr = Buffer.from(proc.stderr).toString()
  for (const line of stderr.split('\n')) {
    if (line.includes(' ERROR ') || line.includes('Adjusted '))
      process.stderr.write(line + '\n')
    else if (values.v && line.includes('SSR cap'))
      process.stderr.write(line + '\n')
  }
  if (proc.exitCode !== 0) {
    process.stderr.write(
      `Failed: bid-distribution-cli exited ${proc.exitCode}\n`,
    )
    process.exit(1)
  }
  return out
}

console.log('epochs:')
for (let epoch = epochStart; epoch <= epochEnd; epoch++) {
  const prodFile = values.c ? fetchProductionSettlement(epoch) : null
  if (!values.c) fetchInputs(epoch)

  const epochData = ssr.epochs.find(e => e.epoch === epoch)
  if (!epochData) {
    process.stderr.write(`  # epoch ${epoch} not in SSR feed, skipping\n`)
    continue
  }
  const prev = ssr.epochs.find(e => e.epoch === epoch - 1)
  const epy = prev ? 31557600 / (epochData.time - prev.time) : 182

  console.log(`- epoch: ${epoch}`)
  console.log(`  time: ${epochData.time}`)
  console.log(`  ssr_pmpe: ${epochData.pmpe}`)
  console.log(`  ssr_apy: ${apy(epochData.pmpe, epy)}`)
  console.log(`  epochs_per_year: ${Math.floor(epy)}`)
  console.log('  simulations:')

  const inp = `${dataDir}/${epoch}/inputs`

  const feesToRun = prodFile ? [null] : fees
  for (const fee of feesToRun) {
    let cfgText = cfgTemplate
    if (fee != null)
      cfgText = cfgTemplate.replace(/(max_fee_bps:)\s*\d+/, `$1 ${fee}`)
    if (values.m !== undefined)
      cfgText = cfgText.replace(/(min_fee_bps:)\s*\d+/, `$1 ${values.m}`)
    const cfg = loadConfig(cfgText)
    const minFee = cfg.fee_config.min_fee_bps
    const maxFee = cfg.fee_config.max_fee_bps

    let settlementsJson: string
    if (prodFile) {
      settlementsJson = prodFile
    } else {
      const cfgFile = tmpFile()
      await writeFile(cfgFile, cfgText)
      settlementsJson = runCli(cfgFile, inp)
    }

    const {
      settlements,
      adj_max_fee_bps: adjMax,
      adj_min_fee_bps: adjMin,
    } = (await Bun.file(settlementsJson).json()) as {
      settlements: Settlement[]
      adj_max_fee_bps?: number
      adj_min_fee_bps?: number
    }
    const bidSettlements = settlements.filter(
      (s): s is BidSettlement => s.reason === 'Bidding' && s.details !== null,
    )
    const bidDetails = bidSettlements.map(s => s.details)
    if (!bidDetails.length) {
      process.stderr.write(`  # no data for fee=${fee} epoch=${epoch}\n`)
      continue
    }

    const activeStake = bidDetails.reduce(
      (sum, d) => sum + d.total_marinade_active_stake,
      0,
    )
    const rustRedeleg = bidDetails.reduce(
      (sum, d) => sum + (d.total_marinade_redelegation_stake ?? 0),
      0,
    )
    const stakesPath = join(inp, 'stakes.json')
    const fieldAbsent = bidDetails.some(
      d => d.total_marinade_redelegation_stake === undefined,
    )
    const redeleg = !fieldAbsent
      ? rustRedeleg
      : existsSync(stakesPath)
        ? await redelegationStakeFromFile(stakesPath, cfg)
        : 0
    if (fieldAbsent && redeleg > 0)
      process.stderr.write('  # redeleg from stakes.json (approx)\n')
    const stake = activeStake + redeleg
    const totalRewards = bidDetails.reduce(
      (sum, d) => sum + parseFloat(d.total_marinade_stakers_rewards),
      0,
    )
    const feeAdj = settlements.reduce(
      (sum, s) =>
        sum +
        (s.reason === 'Bidding' || s.reason === 'PriorityFee'
          ? s.details.marinade_fee_claim + s.details.dao_fee_claim
          : 0),
      0,
    )
    const stakerExtras = sumStakerExtras(settlements)
    const protectedEventClaims = settlements.reduce(
      (sum, s) => (isProtectedEvent(s.reason) ? sum + s.claims_amount : sum),
      0,
    )
    const penaltyStakerClaims = stakerExtras - protectedEventClaims
    const pmpeAdj = ((totalRewards - feeAdj + stakerExtras) / stake) * 1000
    const pmpeMax =
      ((totalRewards * (1 - maxFee / 10000) + stakerExtras) / stake) * 1000
    const feesByVote = feesByVoteAccount(settlements)
    const nCapped =
      adjMax !== undefined
        ? bidSettlements.filter(s => {
            const rewards = parseFloat(s.details.total_marinade_stakers_rewards)
            const totalFee = feesByVote.get(s.vote_account) ?? 0
            return rewards > 0 && totalFee < (rewards * adjMax * 0.9999) / 10000
          }).length
        : null
    const nAtMin =
      adjMin !== undefined
        ? bidSettlements.filter(s => {
            const rewards = parseFloat(s.details.total_marinade_stakers_rewards)
            const totalFee = feesByVote.get(s.vote_account) ?? 0
            return (
              rewards > 0 && totalFee <= (rewards * adjMin * 1.0001) / 10000
            )
          }).length
        : null

    console.log(`  - max_fee_bps: ${maxFee}`)
    console.log(`    min_fee_bps: ${minFee}`)
    console.log(`    marinade_stake_sol: ${sol(stake)}`)
    const pmpePreFee = ((totalRewards + stakerExtras) / stake) * 1000
    console.log(`    pre_fee_pmpe: ${pmpePreFee.toFixed(6)}`)
    console.log(`    post_fee_pmpe_adj: ${pmpeAdj.toFixed(6)}`)
    console.log(`    post_fee_pmpe_max: ${pmpeMax.toFixed(6)}`)
    console.log(`    apy_pre_fee: ${apy(pmpePreFee, epy)}`)
    console.log(`    apy_adj: ${apy(pmpeAdj, epy)}`)
    console.log(`    apy_max: ${apy(pmpeMax, epy)}`)
    console.log(`    fee_sol_adj: ${sol(feeAdj)}`)
    console.log(`    fee_sol_max: ${sol((totalRewards * maxFee) / 10000)}`)
    if (protectedEventClaims > 0)
      console.log(`    psr_sol_to_stakers: ${sol(protectedEventClaims)}`)
    if (penaltyStakerClaims > 0)
      console.log(`    penalty_sol_to_stakers: ${sol(penaltyStakerClaims)}`)
    if (nCapped !== null)
      console.log(`    validators_capped: ${nCapped}/${bidSettlements.length}`)
    if (nAtMin !== null)
      console.log(
        `    validators_at_min_fee: ${nAtMin}/${bidSettlements.length}`,
      )
  }
}
