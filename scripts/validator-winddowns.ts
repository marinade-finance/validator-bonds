#!/usr/bin/env bun
import { existsSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    epochs: { type: 'string', default: '20' },
    'min-sol': { type: 'string', default: '1000' },
    'pct-drop': { type: 'string', default: '50' }, // % stake lost in one epoch = wind-down
    top: { type: 'string', default: '5' },
    json: { type: 'boolean', default: false },
    cache: { type: 'boolean', default: false },
  },
})

const CACHE_FILE = './tmp/winddowns-cache.json'
const minStake = BigInt(Math.round(Number(values['min-sol']) * 1e9))
const epochCount = Number(values.epochs)
const topN = Number(values.top)
const pctDrop = Number(values['pct-drop']) // e.g. 50 means lost ≥50% = wind-down

// ---- api types ---------------------------------------------------------------

type ValidatorEpochStat = {
  epoch: number
  activated_stake: string | null
  marinade_stake: string | null
  marinade_native_stake: string | null
  institutional_stake: string | null
  foundation_stake: string | null
}

type Validator = {
  vote_account: string
  info_name: string | null
  epoch_stats: ValidatorEpochStat[]
}

type ApiResponse = {
  validators: Validator[]
}

// ---- domain types ------------------------------------------------------------

type EpochEntry = {
  vote_account: string
  name: string
  activated: bigint
  marinade: bigint
  native: bigint
  institutional: bigint
}

type WindDown = {
  vote_account: string
  name: string
  prev_sol: number
  curr_sol: number
  marinade_sol: number
  pct_lost: number
}

type Gainer = {
  vote_account: string
  name: string
  gained_sol: number
  marinade_gained_sol: number
}

type EpochReport = {
  epoch: number
  wind_downs: WindDown[]
  sol_lost: number
  marinade_lost: number
  top_gainers: Gainer[]
}

// ---- fetch / cache -----------------------------------------------------------

const fetchValidators = async (): Promise<ApiResponse> => {
  if (values.cache && existsSync(CACHE_FILE)) {
    process.stderr.write(`using cache: ${CACHE_FILE}\n`)
    return JSON.parse(await Bun.file(CACHE_FILE).text()) as ApiResponse
  }
  process.stderr.write(`fetching all validators (epoch_stats=${epochCount})…\n`)
  const url = `https://validators-api.marinade.finance/validators?limit=2000&epoch_stats=${epochCount}`
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`API error ${resp.status}: ${url}`)
  const data = (await resp.json()) as ApiResponse
  process.stderr.write(`fetched ${data.validators.length} validators\n`)
  if (values.cache) {
    writeFileSync(CACHE_FILE, JSON.stringify(data))
    process.stderr.write(`cached to ${CACHE_FILE}\n`)
  }
  return data
}

// ---- build epoch map ---------------------------------------------------------

const { validators } = await fetchValidators()

const epochMap = new Map<number, Map<string, EpochEntry>>()

for (const validator of validators) {
  const name = validator.info_name ?? validator.vote_account.slice(0, 8)
  for (const stat of validator.epoch_stats ?? []) {
    let byVote = epochMap.get(stat.epoch)
    if (!byVote) {
      byVote = new Map()
      epochMap.set(stat.epoch, byVote)
    }
    byVote.set(validator.vote_account, {
      vote_account: validator.vote_account,
      name,
      activated: BigInt(stat.activated_stake ?? 0),
      marinade: BigInt(stat.marinade_stake ?? 0),
      native: BigInt(stat.marinade_native_stake ?? 0),
      institutional: BigInt(stat.institutional_stake ?? 0),
    })
  }
}

const epochs = [...epochMap.keys()].sort((a, b) => a - b)
const threshold = BigInt(pctDrop)

// ---- analyse transitions -----------------------------------------------------

const reports: EpochReport[] = []

for (let i = 1; i < epochs.length; i++) {
  const prevEpoch = epochs[i - 1]
  const currEpoch = epochs[i]
  const prev = epochMap.get(prevEpoch)
  const curr = epochMap.get(currEpoch)
  if (!prev || !curr) continue

  const windDowns: WindDown[] = []
  let totalLost = 0n
  let marinadeLost = 0n

  for (const [va, ps] of prev) {
    if (ps.activated < minStake) continue
    const cs = curr.get(va)
    const currActivated = cs?.activated ?? 0n
    // wind-down: lost ≥pctDrop% of activated stake in one epoch
    if (currActivated * 100n > ps.activated * (100n - threshold)) continue
    const lost = ps.activated - currActivated
    const mndeManaged = ps.marinade + ps.native + ps.institutional
    totalLost += lost
    marinadeLost += mndeManaged
    windDowns.push({
      vote_account: va,
      name: ps.name,
      prev_sol: Number(ps.activated) / 1e9,
      curr_sol: Number(currActivated) / 1e9,
      marinade_sol: Number(mndeManaged) / 1e9,
      pct_lost: Number((lost * 100n) / ps.activated),
    })
  }

  windDowns.sort((a, b) => b.prev_sol - a.prev_sol)

  const gainers: Gainer[] = []
  for (const [va, cs] of curr) {
    const ps = prev.get(va)
    if (!ps) continue
    const gained = cs.activated - ps.activated
    if (gained <= 0n) continue
    const mGained =
      cs.marinade +
      cs.native +
      cs.institutional -
      (ps.marinade + ps.native + ps.institutional)
    gainers.push({
      vote_account: va,
      name: cs.name,
      gained_sol: Number(gained) / 1e9,
      marinade_gained_sol: Number(mGained > 0n ? mGained : 0n) / 1e9,
    })
  }
  gainers.sort((a, b) => b.gained_sol - a.gained_sol)

  if (windDowns.length > 0) {
    reports.push({
      epoch: currEpoch,
      wind_downs: windDowns,
      sol_lost: Number(totalLost) / 1e9,
      marinade_lost: Number(marinadeLost) / 1e9,
      top_gainers: gainers.slice(0, topN),
    })
  }
}

// ---- output ------------------------------------------------------------------

const fmtSol = (n: number) =>
  n.toLocaleString('en-US', { maximumFractionDigits: 0 })

const trunc = (s: string, n: number) =>
  s.length > n ? s.slice(0, n - 1) + '…' : s

if (values.json) {
  process.stdout.write(JSON.stringify(reports, null, 2) + '\n')
} else if (reports.length === 0) {
  process.stdout.write(
    `no wind-downs found in last ${epochCount} epochs (min-sol=${values['min-sol']}, pct-drop=${pctDrop})\n`,
  )
} else {
  process.stdout.write('\n=== validator wind-down summary ===\n\n')
  process.stdout.write(
    ` threshold: ≥${pctDrop}% stake lost in one epoch, min stake: ${values['min-sol']} SOL\n\n`,
  )
  process.stdout.write(
    ' epoch | count |      SOL lost | Marinade lost\n' +
      '-------|-------|---------------|---------------\n',
  )
  for (const report of reports) {
    process.stdout.write(
      ` ${String(report.epoch).padStart(5)} | ${String(report.wind_downs.length).padStart(5)} | ${fmtSol(report.sol_lost).padStart(13)} | ${fmtSol(report.marinade_lost).padStart(13)}\n`,
    )
  }
  process.stdout.write('\n')

  for (const report of reports) {
    process.stdout.write(
      `\n── epoch ${report.epoch} ──────────────────────────────────────────\n`,
    )
    process.stdout.write(
      `   wind-downs: ${report.wind_downs.length}  |  SOL lost: ${fmtSol(report.sol_lost)}  |  Marinade managed: ${fmtSol(report.marinade_lost)}\n\n`,
    )

    process.stdout.write('  wound-down validators:\n')
    for (const wd of report.wind_downs) {
      const tag = trunc(wd.name, 24).padEnd(24)
      const prev = fmtSol(wd.prev_sol).padStart(12)
      const after = fmtSol(wd.curr_sol).padStart(10)
      const mnde =
        wd.marinade_sol > 0
          ? `  [Marinade: ${fmtSol(wd.marinade_sol)} SOL]`
          : ''
      process.stdout.write(
        `    ${tag}  ${prev} SOL → ${after} SOL  (${wd.pct_lost}% lost)${mnde}\n`,
      )
    }

    if (report.top_gainers.length > 0) {
      process.stdout.write('\n  top gainers this epoch:\n')
      for (const gainer of report.top_gainers) {
        const tag = trunc(gainer.name, 24).padEnd(24)
        const gained = fmtSol(gainer.gained_sol).padStart(12)
        const mnde =
          gainer.marinade_gained_sol > 0
            ? `  [Marinade: +${fmtSol(gainer.marinade_gained_sol)} SOL]`
            : ''
        process.stdout.write(`    ${tag}  +${gained} SOL${mnde}\n`)
      }
    }
  }

  process.stdout.write('\n')
}
