#!/usr/bin/env bun
/* eslint-disable n/no-process-exit */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'

// eslint-disable-next-line import/no-extraneous-dependencies
import { parse as parseYaml } from 'yaml'

import {
  type Settlement,
  type BidSettlement,
  isProtectedEvent,
  isFeeSettlement,
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
    s: { type: 'string' },
    'target-sol': { type: 'string' },
    n: { type: 'string' },
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
if (!epochArg) {
  process.stderr.write(
    'Simulates bid-distribution-cli across a range of epochs at multiple fee tiers.\n' +
      'Patches settlement-config.yaml per (epoch, fee) pair, runs the CLI, and computes\n' +
      'post-fee pmpe (adj = actual fees deducted, max = uniform max fee).\n' +
      'Fetches SSR timing from apy-api to convert pmpe → APY.\n' +
      '\n' +
      'usage: bun scripts/simulate-fee.ts [-r] [-v] [-c] [-d DIR] <epoch|start-end> [-m <min_fee>] [<max_fee>]...\n' +
      '  -d DIR  data dir (default: $DATA_DIR or ./regression-data)\n' +
      '  -c      read production settlement from GCS instead of re-running CLI\n' +
      '\n' +
      'epoch header fields:\n' +
      '  ssr_pmpe / ssr_apy          Solana Staking Rate — baseline staking return\n' +
      '  min_yield_premium_pmpe      min_yield_premium_over_ssr_pmpe from settlement-config\n' +
      '  min_yield_floor_pmpe/apy    SSR + premium — the floor the tuner targets for stakers\n' +
      '  inf_apy                     Sanctum INF APY for reference (source: DefiLlama;\n' +
      '                              only emitted for epochs within ~30d of a data point)\n' +
      '  epochs_per_year             year / epoch duration, used to compound pmpe → apy\n' +
      '\n' +
      'simulation fields:\n' +
      '  max_fee_bps / min_fee_bps   fee bounds the CLI ran with (after -m / max_fee args)\n' +
      '  marinade_stake_sol          active + redelegation Marinade stake the fee is drawn from\n' +
      '  pre_fee_pmpe/apy            gross staker yield before Marinade fee\n' +
      '  post_fee_pmpe_adj/apy_adj   net staker yield using actual fees from settlements\n' +
      '  post_fee_pmpe_max/apy_max   net staker yield if every validator charged max_fee\n' +
      '    (theoretical; does not account for settlement cap)\n' +
      '  fee_sol_adj                 actual Marinade fee = Σ(marinade_fee_claim + dao_fee_claim)\n' +
      '  fee_sol_max                 min(total_rewards × max_fee, settlement_sol) — capped at bond\n' +
      '  settlement_sol              total bond payout = Σ(staker_claims + fees); hard cap on fee\n' +
      '  psr_sol_to_stakers          PSR protected-event claims redistributed to stakers (if any)\n' +
      '  penalty_sol_to_stakers      bid-too-low / blacklist penalty claims to stakers (if any)\n' +
      '  validators_capped           validators where actual fee < adj_max_fee (hit settlement cap)\n' +
      '  validators_at_min_fee       validators paying the minimum floor fee\n' +
      '  adj_max_fee_bps             tuned max fee found by bisection (Phase 1)\n' +
      '  adj_min_fee_bps             tuned min fee raised to use remaining budget (Phase 2)\n',
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

const INF_LLAMA =
  'https://yields.llama.fi/chart/3075a746-bdd1-4aac-bcd5-b035abee2622'
type LlamaPoint = { timestamp: string; apy: number }
const infRes = await fetch(INF_LLAMA)
const infPoints: LlamaPoint[] = infRes.ok
  ? ((await infRes.json()) as { data: LlamaPoint[] }).data
  : []
function infApyAt(epochTime: number): number | null {
  if (!infPoints.length) return null
  let best = infPoints[0]
  let bestDiff = Math.abs(new Date(best.timestamp).getTime() / 1000 - epochTime)
  for (const p of infPoints) {
    const diff = Math.abs(new Date(p.timestamp).getTime() / 1000 - epochTime)
    if (diff < bestDiff) {
      bestDiff = diff
      best = p
    }
  }
  return bestDiff < 30 * 86400 ? best.apy : null
}

const STAKES_FILE = 'stakes.json'
const SAM_FILE = 'sam-scores.json'
const VALIDATORS_FILE = 'validators.json'

const INPUTS = [
  STAKES_FILE,
  SAM_FILE,
  VALIDATORS_FILE,
  'evaluation.json',
  'rewards/mev.json',
  'rewards/validators_mev.json',
  'rewards/inflation.json',
  'rewards/validators_inflation.json',
  'rewards/validators_blocks.json',
  'rewards/jito_priority_fee.json',
]

mkdirSync('./tmp', { recursive: true })
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
const baseCfg = loadConfig(cfgTemplate)

type BidConfig = {
  whitelist_stake_authorities?: string[]
  exiting_stake_authorities?: string[]
  fee_config: {
    min_fee_bps: number
    max_fee_bps: number
    min_yield_premium_over_ssr_pmpe?: number
    target_sol_revenue?: number
  }
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
const GCS_ETL = 'gs://marinade-stakes-etl-mainnet'
const SCORING_API = 'https://scoring.marinade.finance/api/v1'
const PROD_FILE = 'bid-distribution-settlements.json'

const gcsBonds = (epoch: number, file: string) =>
  `${GCS_BONDS}/${epoch}/${file}`
const gcsEtl = (epoch: number, file: string) => `${GCS_ETL}/${epoch}/${file}`
const scoringUrl = (epoch: number) => `${SCORING_API}/scores/sam?epoch=${epoch}`

async function runMkdir(dir: string): Promise<void> {
  await Bun.spawn(['mkdir', '-p', dir], { stderr: 'pipe' }).exited
}

async function runGcsCp(src: string, dst: string): Promise<void> {
  const code = await Bun.spawn(['gcloud', 'storage', 'cp', src, dst], {
    stderr: 'pipe',
  }).exited
  if (code !== 0) {
    process.stderr.write(`Failed: gcloud cp ${src}\n`)
    process.exit(code ?? 1)
  }
}

async function runHttpGet(url: string, dst: string): Promise<void> {
  const code = await Bun.spawn(['curl', '-sf', url, '-o', dst], {
    stderr: 'pipe',
  }).exited
  if (code !== 0) {
    process.stderr.write(`Failed: curl ${url}\n`)
    process.exit(code ?? 1)
  }
}

async function runGzip(f: string): Promise<void> {
  const code = await Bun.spawn(['gzip', f], { stderr: 'pipe' }).exited
  if (code !== 0) {
    process.stderr.write(`Failed: gzip ${f}\n`)
    process.exit(code ?? 1)
  }
}

async function fetchProductionSettlement(epoch: number): Promise<string> {
  const dir = join(dataDir, String(epoch))
  const path = join(dir, PROD_FILE)
  if (!existsSync(path)) {
    process.stderr.write(`  # downloading ${PROD_FILE} for epoch ${epoch}...\n`)
    await runMkdir(dir)
    await runGcsCp(gcsBonds(epoch, PROD_FILE), path)
  }
  if (!existsSync(path)) {
    process.stderr.write(`Failed: ${PROD_FILE} not found for epoch ${epoch}\n`)
    process.exit(1)
  }
  return path
}

async function fetchInputs(epoch: number): Promise<void> {
  const inp = join(dataDir, String(epoch), 'inputs')
  const rwd = join(inp, 'rewards')
  if (INPUTS.every(f => existsSync(join(inp, f) + '.gz'))) return
  process.stderr.write(`  # fetching inputs for epoch ${epoch}...\n`)
  await runMkdir(rwd)

  const gz = (f: string) => f + '.gz'
  const fetchOne = async (src: string, dst: string) => {
    if (existsSync(gz(dst))) return
    await runGcsCp(src, dst)
    await runGzip(dst)
  }

  await fetchOne(gcsBonds(epoch, STAKES_FILE), join(inp, STAKES_FILE))
  await fetchOne(gcsBonds(epoch, VALIDATORS_FILE), join(inp, VALIDATORS_FILE))
  await fetchOne(
    gcsBonds(epoch, 'bid-psr-distribution-evaluation.json'),
    join(inp, 'evaluation.json'),
  )
  await fetchOne(gcsEtl(epoch, 'rewards_mev.json'), join(rwd, 'mev.json'))
  await fetchOne(
    gcsEtl(epoch, 'rewards_validators_mev.json'),
    join(rwd, 'validators_mev.json'),
  )
  await fetchOne(
    gcsEtl(epoch, 'rewards_inflation.json'),
    join(rwd, 'inflation.json'),
  )
  await fetchOne(
    gcsEtl(epoch, 'rewards_validators_inflation.json'),
    join(rwd, 'validators_inflation.json'),
  )
  await fetchOne(
    gcsEtl(epoch, 'rewards_validators_blocks.json'),
    join(rwd, 'validators_blocks.json'),
  )
  await fetchOne(
    gcsEtl(epoch, 'rewards_priority_fee.json'),
    join(rwd, 'jito_priority_fee.json'),
  )

  const samPath = join(inp, SAM_FILE)
  if (!existsSync(gz(samPath))) {
    await runHttpGet(scoringUrl(epoch), samPath)
    await runGzip(samPath)
  }

  if (!INPUTS.every(f => existsSync(join(inp, gz(f))))) {
    process.stderr.write(`Failed: fetch failed for epoch ${epoch}\n`)
    process.exit(1)
  }
}

async function runBidDistributionCli(
  cfgFile: string,
  inp: string,
): Promise<string> {
  const out = tmpFile()
  const tmp = mkdtempSync(join(tmpdir(), 'bd-'))
  try {
    for (const f of INPUTS) {
      const src = join(inp, f)
      const dst = join(tmp, f)
      await Bun.spawn(['mkdir', '-p', dirname(dst)], { stderr: 'pipe' }).exited
      if (existsSync(src + '.gz'))
        await Bun.spawn(['sh', '-c', `gzip -dc "${src}.gz" > "${dst}"`], {
          stderr: 'pipe',
        }).exited
      else await Bun.spawn(['cp', src, dst], { stderr: 'pipe' }).exited
    }
    const proc = Bun.spawn(
      [
        ...cli,
        '--settlement-config',
        cfgFile,
        '--stake-meta-collection',
        `${tmp}/${STAKES_FILE}`,
        '--sam-meta-collection',
        `${tmp}/sam-scores.json`,
        '--rewards-dir',
        `${tmp}/rewards`,
        '--validator-meta-collection',
        `${tmp}/validators.json`,
        '--revenue-expectation-collection',
        `${tmp}/evaluation.json`,
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
    const [code, stderrBuf] = await Promise.all([
      proc.exited,
      new Response(proc.stderr).arrayBuffer(),
    ])
    const stderr = Buffer.from(stderrBuf).toString()
    for (const line of stderr.split('\n')) {
      if (
        line.includes(' ERROR ') ||
        line.includes('Adjusted ') ||
        line.includes('converged at') ||
        line.includes('adj_max_fee_bps')
      )
        process.stderr.write(line + '\n')
      else if (
        values.v &&
        (line.includes('SSR cap') || line.includes('fee: effective:'))
      )
        process.stderr.write(line + '\n')
    }
    if (code !== 0) {
      if (stderr) process.stderr.write(stderr)
      throw new Error(`bid-distribution-cli exited ${code}`)
    }
  } finally {
    rmSync(tmp, { recursive: true })
  }
  return out
}

async function processEpoch(epoch: number): Promise<string | null> {
  const epochData = ssr.epochs.find(e => e.epoch === epoch)
  if (!epochData) {
    process.stderr.write(`epoch ${epoch}: not in SSR feed, skipping\n`)
    return null
  }

  const prodFile = values.c ? await fetchProductionSettlement(epoch) : null
  if (!values.c) await fetchInputs(epoch)

  const prev = ssr.epochs.find(e => e.epoch === epoch - 1)
  const epy = prev ? 31557600 / (epochData.time - prev.time) : 182
  const yieldPremium = baseCfg.fee_config.min_yield_premium_over_ssr_pmpe

  const out: string[] = []
  const emit = (s: string) => out.push(s)

  emit(`- epoch: ${epoch}`)
  emit(`  time: ${new Date(epochData.time * 1000).toISOString()}`)
  emit(`  ssr_pmpe: ${epochData.pmpe}`)
  emit(`  ssr_apy: ${apy(epochData.pmpe, epy)}`)
  if (yieldPremium != null) {
    const floorPmpe = epochData.pmpe + yieldPremium
    emit(`  min_yield_premium_pmpe: ${yieldPremium}`)
    emit(`  min_yield_floor_pmpe: ${floorPmpe.toFixed(6)}`)
    emit(`  min_yield_floor_apy: ${apy(floorPmpe, epy)}`)
  }
  const targetSolArg = values['target-sol'] ?? values.s
  if (targetSolArg !== undefined)
    emit(`  target_sol_revenue_sol: ${targetSolArg}`)
  const infApy = infApyAt(epochData.time)
  if (infApy !== null) emit(`  inf_apy: ${infApy.toFixed(2)}%`)
  emit(`  epochs_per_year: ${Math.floor(epy)}`)
  emit('  simulations:')

  const inp = `${dataDir}/${epoch}/inputs`
  const feesToRun = prodFile ? [null] : fees

  for (const fee of feesToRun) {
    let cfgText = cfgTemplate
    if (fee != null)
      cfgText = cfgTemplate.replace(/(max_fee_bps:)\s*\d+/, `$1 ${fee}`)
    if (values.m !== undefined)
      cfgText = cfgText.replace(/(min_fee_bps:)\s*\d+/, `$1 ${values.m}`)
    const targetSol = values['target-sol'] ?? values.s
    if (targetSol !== undefined) {
      if (/target_sol_revenue:/.test(cfgText)) {
        cfgText = cfgText.replace(
          /(target_sol_revenue:)\s*[\d.]+/,
          `$1 ${targetSol}`,
        )
      } else {
        cfgText = cfgText.replace(
          /(min_fee_bps:.*\n)/,
          `$1  target_sol_revenue: ${targetSol}\n`,
        )
      }
      cfgText = cfgText.replace(/^\s*min_yield_premium_over_ssr_pmpe:.*\n/m, '')
    }
    const cfg = loadConfig(cfgText)
    const minFee = cfg.fee_config.min_fee_bps
    const maxFee = cfg.fee_config.max_fee_bps

    let settlementsJson: string
    if (prodFile) {
      settlementsJson = prodFile
    } else {
      process.stderr.write(`epoch ${epoch}: running cli [${maxFee} bps]\n`)
      const cfgFile = tmpFile()
      writeFileSync(cfgFile, cfgText)
      try {
        settlementsJson = await runBidDistributionCli(cfgFile, inp)
      } catch {
        process.stderr.write(
          `epoch ${epoch}: cli failed, wiping inputs and retrying\n`,
        )
        rmSync(inp, { recursive: true })
        await fetchInputs(epoch)
        settlementsJson = await runBidDistributionCli(cfgFile, inp)
      }
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
      process.stderr.write(`epoch ${epoch}: no data for fee=${fee}, skipping\n`)
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
    const stakesPath = join(inp, STAKES_FILE)
    const redeleg =
      rustRedeleg > 0
        ? rustRedeleg
        : existsSync(stakesPath)
          ? await redelegationStakeFromFile(stakesPath, cfg)
          : 0
    const stake = activeStake + redeleg
    const bidVotes = new Set(bidSettlements.map(s => s.vote_account))
    const totalRewards =
      bidDetails.reduce(
        (sum, d) => sum + parseFloat(d.total_marinade_stakers_rewards),
        0,
      ) +
      settlements.reduce((sum, s) => {
        if (s.reason === 'PriorityFee' && !bidVotes.has(s.vote_account))
          return sum + parseFloat(s.details.activating_bid_claim)
        return sum
      }, 0)
    const feeAdj = settlements
      .filter(isFeeSettlement)
      .reduce(
        (sum, s) =>
          sum + s.details.marinade_fee_claim + s.details.dao_fee_claim,
        0,
      )
    const settlementSol = settlements
      .filter(isFeeSettlement)
      .reduce((sum, s) => sum + s.claims_amount, 0)
    const stakerExtras = sumStakerExtras(settlements)
    const protectedEventClaims = settlements.reduce(
      (sum, s) => (isProtectedEvent(s.reason) ? sum + s.claims_amount : sum),
      0,
    )
    const penaltyStakerClaims = stakerExtras - protectedEventClaims
    const pmpeAdj = ((totalRewards - feeAdj + stakerExtras) / stake) * 1000
    const feeMax = Math.min((totalRewards * maxFee) / 10000, settlementSol)
    const pmpeMax = ((totalRewards - feeMax + stakerExtras) / stake) * 1000
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

    emit(`  - max_fee_bps: ${maxFee}`)
    emit(`    min_fee_bps: ${minFee}`)
    emit(`    marinade_stake_sol: ${sol(stake)}`)
    const pmpePreFee = ((totalRewards + stakerExtras) / stake) * 1000
    emit(`    pre_fee_pmpe: ${pmpePreFee.toFixed(6)}`)
    emit(`    post_fee_pmpe_adj: ${pmpeAdj.toFixed(6)}`)
    emit(`    post_fee_pmpe_max: ${pmpeMax.toFixed(6)}`)
    emit(`    apy_pre_fee: ${apy(pmpePreFee, epy)}`)
    emit(`    apy_adj: ${apy(pmpeAdj, epy)}`)
    emit(`    apy_max: ${apy(pmpeMax, epy)}`)
    emit(`    fee_sol_adj: ${sol(feeAdj)}`)
    emit(`    fee_sol_max: ${sol(feeMax)}`)
    emit(`    settlement_sol: ${sol(settlementSol)}`)
    if (protectedEventClaims > 0)
      emit(`    psr_sol_to_stakers: ${sol(protectedEventClaims)}`)
    if (penaltyStakerClaims > 0)
      emit(`    penalty_sol_to_stakers: ${sol(penaltyStakerClaims)}`)
    if (nCapped !== null)
      emit(`    validators_capped: ${nCapped}/${bidSettlements.length}`)
    if (nAtMin !== null)
      emit(`    validators_at_min_fee: ${nAtMin}/${bidSettlements.length}`)
    if (adjMax !== undefined) emit(`    adj_max_fee_bps: ${adjMax}`)
    if (adjMin !== undefined) emit(`    adj_min_fee_bps: ${adjMin}`)
  }

  return out.join('\n') + '\n'
}

// Worker pool: epochs run concurrently; output collected and printed in order.
const CONCURRENCY = values.n ? Number(values.n) : 20
const epochs: number[] = []
for (let e = epochStart; e <= epochEnd; e++) epochs.push(e)

const results: (string | null)[] = Array.from(
  { length: epochs.length },
  () => null,
)
let nextIdx = 0
let doneCount = 0
async function runWorker(): Promise<void> {
  while (nextIdx < epochs.length) {
    const i = nextIdx++
    results[i] = await processEpoch(epochs[i])
    process.stderr.write(
      `epoch ${epochs[i]} done [${++doneCount}/${epochs.length}]\n`,
    )
  }
}
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, epochs.length) }, runWorker),
)

console.log('epochs:')
for (const r of results) {
  if (r) process.stdout.write(r)
}
