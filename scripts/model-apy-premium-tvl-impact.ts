#!/usr/bin/env bun
/* eslint-disable import/no-extraneous-dependencies */
import * as fs from 'node:fs'
import * as path from 'node:path'

import sharp from 'sharp'
import * as vega from 'vega'
import { compile } from 'vega-lite'

import type { TopLevelSpec } from 'vega-lite'

// Does Marinade Native's APY premium over SSR drive net INFLOW? Monthly model:
//   net_flow(t) ~ premium[last month] + premium[last quarter] + premium[last year]
// net_flow = Δlog(native TVL in SOL) minus mechanical reward drift — TVL compounds
// by the staking yield every epoch regardless of flows, so the residual is net
// deposits. TVL is SOL-denominated straight from DeFiLlama tokens.SOL (no price
// contamination). Premium enters at three trailing horizons (non-overlapping age
// bands) as the AVERAGE premium over that band, in percentage points. Effects are
// reported per +10bps because 100bps of premium is a huge, costly lever.

const CACHE = './tmp/model-apy-cache.json'
const OUT = './report/model-apy-premium-tvl-impact.png'
const MONTH = 30 * 86400
const useCache = process.argv.includes('--cache')

// non-overlapping age bands of monthly premium, in months back
const HORIZONS = [
  { name: 'last month', lags: [1] },
  { name: 'last quarter', lags: [2, 3] },
  { name: 'last year', lags: [4, 5, 6, 7, 8, 9, 10, 11, 12] },
]
const PREM_COLS = HORIZONS.map((_, j) => 1 + j) // their columns in the design

// ── API shapes ────────────────────────────────────────────────────────────────

type EpochApyEntry = { epoch: number; time: number; apy: number }
type EpochApyResponse = { epochs: EpochApyEntry[] }
type TokenPoint = { date: number; tokens: { SOL?: number; WSOL?: number } }
type ProtocolResponse = { tokens?: TokenPoint[] }
type TvlEntry = { date: number; sol: number } // native TVL in SOL

type CacheData = {
  native: EpochApyEntry[]
  ssr: EpochApyEntry[]
  tvl: TvlEntry[]
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${String(r.status)} fetching ${url}`)
  return r.json() as Promise<T>
}

// native TVL in SOL from DeFiLlama tokens.SOL (no USD/price contamination)
async function fetchTvlSol(slug: string): Promise<TvlEntry[]> {
  const resp = await fetchJson<ProtocolResponse>(
    `https://api.llama.fi/protocol/${slug}`,
  )
  if (!resp.tokens || resp.tokens.length === 0)
    throw new Error(`no tokens series for ${slug}`)
  const out: TvlEntry[] = []
  for (const p of resp.tokens) {
    const sol = (p.tokens.SOL ?? 0) + (p.tokens.WSOL ?? 0)
    if (sol > 0) out.push({ date: p.date, sol })
  }
  return out
}

async function loadData(): Promise<CacheData> {
  if (useCache && fs.existsSync(CACHE)) {
    console.log('using cache →', CACHE)
    return JSON.parse(fs.readFileSync(CACHE, 'utf8')) as CacheData
  }
  console.log('fetching data...')
  const [nativeResp, ssrResp, tvl] = await Promise.all([
    fetchJson<EpochApyResponse>(
      'https://apy.marinade.finance/v1/epoch-apy/marinade-native',
    ),
    fetchJson<EpochApyResponse>(
      'https://apy.marinade.finance/v1/epoch-apy/ssr',
    ),
    fetchTvlSol('marinade-native'),
  ])
  const data: CacheData = {
    native: nativeResp.epochs,
    ssr: ssrResp.epochs,
    tvl,
  }
  fs.mkdirSync(path.dirname(CACHE), { recursive: true })
  fs.writeFileSync(CACHE, JSON.stringify(data))
  console.log('cached →', CACHE)
  return data
}

// ── Monthly aggregation ─────────────────────────────────────────────────────

type MonthRow = {
  epoch: number
  time: number
  premBps: number // mean native − SSR over the month, in bps
  apy: number // mean native APY over the month
  tvlSol: number // end-of-month native TVL in SOL
}

function nearest<T>(
  arr: T[],
  ts: number,
  getTs: (v: T) => number,
  maxDeltaSec: number,
): T | null {
  let best: T | null = null
  let bestDiff = Infinity
  for (const v of arr) {
    const diff = Math.abs(getTs(v) - ts)
    if (diff < bestDiff) {
      bestDiff = diff
      best = v
    }
  }
  return bestDiff <= maxDeltaSec ? best : null
}

function buildMonths(data: CacheData): MonthRow[] {
  const ssrMap = new Map(data.ssr.map(e => [e.epoch, e.apy]))
  const maxDelta = 3 * 86400
  type Joined = {
    epoch: number
    time: number
    prem: number
    apy: number
    tvlSol: number
  }
  const groups = new Map<number, Joined[]>()

  for (const ep of data.native) {
    const ssr = ssrMap.get(ep.epoch)
    const tvl = nearest(data.tvl, ep.time, v => v.date, maxDelta)
    if (ssr == null || !tvl) continue
    const key = Math.floor(ep.time / MONTH)
    const list = groups.get(key) ?? []
    list.push({
      epoch: ep.epoch,
      time: ep.time,
      prem: (ep.apy - ssr) * 10000,
      apy: ep.apy,
      tvlSol: tvl.sol,
    })
    groups.set(key, list)
  }

  const months: MonthRow[] = []
  for (const list of groups.values()) {
    const last = list[list.length - 1]
    months.push({
      epoch: last.epoch,
      time: last.time,
      premBps: mean(list, j => j.prem),
      apy: mean(list, j => j.apy),
      tvlSol: last.tvlSol, // end-of-month level for the growth calc
    })
  }
  return months.sort((a, b) => a.time - b.time)
}

function mean<T>(arr: T[], f: (v: T) => number): number {
  return arr.reduce((s, v) => s + f(v), 0) / arr.length
}

// ── Design matrix ───────────────────────────────────────────────────────────

type Design = { X: number[][]; y: number[]; names: string[] }

function buildDesign(months: MonthRow[]): Design {
  // average premium over an age band, in percentage points
  const band = (i: number, lags: number[]) =>
    mean(lags, l => months[i - l].premBps) / 100
  const X: number[][] = []
  const y: number[] = []
  const start = Math.max(...HORIZONS.flatMap(h => h.lags))
  for (let i = start; i < months.length; i++) {
    const days = (months[i].time - months[i - 1].time) / 86400
    const growth = Math.log(months[i].tvlSol / months[i - 1].tvlSol)
    const mechanical = months[i].apy * (days / 365) // rewards compound regardless
    y.push(growth - mechanical) // net SOL inflow: Δlog supply − reward drift
    X.push([1, ...HORIZONS.map(h => band(i, h.lags))])
  }
  const names = ['intercept', ...HORIZONS.map(h => h.name)]
  return { X, y, names }
}

// ── OLS with coefficient covariance ─────────────────────────────────────────

type OlsResult = {
  beta: number[]
  se: number[]
  tstat: number[]
  cov: number[][]
  rSquared: number
  n: number
}

function ols(X: number[][], y: number[]): OlsResult {
  const n = y.length
  const k = X[0].length
  const XtX: number[][] = Array.from({ length: k }, () =>
    new Array<number>(k).fill(0),
  )
  const Xty: number[] = new Array<number>(k).fill(0)
  for (let i = 0; i < n; i++)
    for (let a = 0; a < k; a++) {
      Xty[a] += X[i][a] * y[i]
      for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b]
    }
  const inv = invertMatrix(XtX)
  const beta: number[] = new Array<number>(k).fill(0)
  for (let a = 0; a < k; a++)
    for (let b = 0; b < k; b++) beta[a] += inv[a][b] * Xty[b]

  const ybar = y.reduce((s, v) => s + v, 0) / n
  let rss = 0
  let tss = 0
  for (let i = 0; i < n; i++) {
    const yhat = X[i].reduce((s, v, j) => s + v * beta[j], 0)
    rss += (y[i] - yhat) ** 2
    tss += (y[i] - ybar) ** 2
  }
  const s2 = rss / (n - k)
  const cov = inv.map(row => row.map(v => v * s2))
  const se = cov.map((row, a) => Math.sqrt(row[a]))
  const tstat = beta.map((b, a) => b / se[a])
  return { beta, se, tstat, cov, rSquared: 1 - rss / tss, n }
}

// estimate + t-stat of a linear combination wᵀβ, joint SE from the covariance
function linComb(fit: OlsResult, w: number[]): { beta: number; t: number } {
  const beta = w.reduce((s, wi, i) => s + wi * fit.beta[i], 0)
  let varSum = 0
  for (let i = 0; i < w.length; i++)
    for (let j = 0; j < w.length; j++) varSum += w[i] * w[j] * fit.cov[i][j]
  return { beta, t: beta / Math.sqrt(varSum) }
}

function invertMatrix(m: number[][]): number[][] {
  const n = m.length
  const aug: number[][] = m.map((row, i) => {
    const r = [...row]
    for (let j = 0; j < n; j++) r.push(j === i ? 1 : 0)
    return r
  })
  for (let col = 0; col < n; col++) {
    let maxRow = col
    for (let row = col + 1; row < n; row++)
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row
    ;[aug[col], aug[maxRow]] = [aug[maxRow], aug[col]]
    const pivot = aug[col][col]
    if (Math.abs(pivot) < 1e-14) throw new Error('singular matrix')
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivot
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const f = aug[row][col]
      for (let j = 0; j < 2 * n; j++) aug[row][j] -= f * aug[col][j]
    }
  }
  return aug.map(row => row.slice(n))
}

// ── effect helpers ──────────────────────────────────────────────────────────

// +10bps = +0.1pp; β is net-flow (log) per pp ⇒ %/month = β·0.1·100 = β.
// per-horizon effect of +10bps:
function effect10(beta: number): number {
  return beta * 0.1 * 100
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const data = await loadData()
  const months = buildMonths(data)
  const { X, y, names } = buildDesign(months)
  if (y.length < 12) throw new Error(`too few months: ${String(y.length)}`)
  const fit = ols(X, y)

  // headline: a sustained +10bps premium across ALL horizons (long-run multiplier)
  const wAll = fit.beta.map((_, i) => (PREM_COLS.includes(i) ? 1 : 0))
  const sustained = linComb(fit, wAll)
  const perMonth = effect10(sustained.beta)
  const perYear = ((1 + perMonth / 100) ** 12 - 1) * 100

  console.log(`MONTHLY  n=${String(fit.n)}  R²=${fit.rSquared.toFixed(3)}\n`)
  console.log('  horizon         +10bps→%/mo      beta        t    sig')
  fit.beta.forEach((b, i) => {
    const eff = PREM_COLS.includes(i)
      ? `${effect10(b).toFixed(2)}%`.padStart(8)
      : '       —'
    const sig = Math.abs(fit.tstat[i]) > 2 ? 'SIG' : '·'
    console.log(
      `  ${names[i].padEnd(13)} ${eff}   ${b.toExponential(2).padStart(10)}` +
        ` ${fit.tstat[i].toFixed(2).padStart(6)}  ${sig}`,
    )
  })
  console.log(
    `\n  sustained +10bps (all horizons) → ${perMonth.toFixed(2)}%/month` +
      ` (~${perYear.toFixed(1)}%/yr)   [t=${sustained.t.toFixed(2)}]`,
  )

  await renderChart(months, fit, perMonth)
  writeSummary(fit, names, perMonth, perYear, sustained.t)
}

// ── Chart ───────────────────────────────────────────────────────────────────

async function renderChart(
  months: MonthRow[],
  fit: OlsResult,
  perMonth: number,
) {
  const C_PREMIUM = '#4682b4'
  const C_TVL = '#2e8b57'
  const C_BAR = '#e07b39'

  const series = months.map(m => ({
    epoch: m.epoch,
    premium: m.premBps,
    tvl: m.tvlSol / 1e6,
  }))
  const effects = HORIZONS.map((h, j) => ({
    horizon: h.name,
    effect: effect10(fit.beta[1 + j] ?? 0),
  }))

  const epochMin = months[0].epoch
  const epochMax = months[months.length - 1].epoch
  const title =
    'Marinade Native APY Premium → TVL · monthly · epochs ' +
    `${String(epochMin)}–${String(epochMax)} · sustained +10bps ≈ ` +
    `${perMonth.toFixed(2)}%/mo`

  const spec: TopLevelSpec = {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    title: { text: title, fontSize: 14, fontWeight: 'bold', offset: 10 },
    background: 'white',
    config: {
      view: { stroke: null },
      axis: {
        grid: true,
        gridOpacity: 0.3,
        labelFontSize: 11,
        titleFontSize: 12,
      },
    },
    spacing: 36,
    vconcat: [
      {
        width: 1100,
        height: 260,
        title: {
          text: 'Monthly APY premium (bps) and TVL (M SOL)',
          fontSize: 13,
        },
        resolve: { scale: { y: 'independent' } },
        layer: [
          {
            data: { values: series },
            mark: { type: 'bar', color: C_PREMIUM, opacity: 0.45 },
            encoding: {
              x: {
                field: 'epoch',
                type: 'quantitative',
                title: 'Epoch',
                axis: { format: 'd' },
              },
              y: {
                field: 'premium',
                type: 'quantitative',
                title: 'APY premium (bps)',
                axis: { labelColor: C_PREMIUM, titleColor: C_PREMIUM },
              },
            },
          },
          {
            data: { values: series },
            mark: {
              type: 'line',
              color: C_TVL,
              strokeWidth: 2,
              strokeDash: [4, 2],
            },
            encoding: {
              x: { field: 'epoch', type: 'quantitative' },
              y: {
                field: 'tvl',
                type: 'quantitative',
                title: 'TVL (M SOL)',
                axis: { labelColor: C_TVL, titleColor: C_TVL, orient: 'right' },
              },
            },
          },
        ],
      },
      {
        width: 1100,
        height: 220,
        title: {
          text: 'Net-flow effect of +10bps premium, by horizon (%/month)',
          fontSize: 13,
        },
        data: { values: effects },
        mark: { type: 'bar', color: C_BAR },
        encoding: {
          x: {
            field: 'horizon',
            type: 'nominal',
            title: null,
            sort: HORIZONS.map(h => h.name),
          },
          y: {
            field: 'effect',
            type: 'quantitative',
            title: '%/month per +10bps',
          },
        },
      },
    ],
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const vegaSpec = compile(spec).spec
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  const view = new vega.View(vega.parse(vegaSpec), { renderer: 'none' })
  const svg = await view.toSVG()
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  await sharp(Buffer.from(svg)).png().toFile(OUT)
  console.log('saved →', OUT)
}

// ── Summary YAML ────────────────────────────────────────────────────────────

function writeSummary(
  fit: OlsResult,
  names: string[],
  perMonth: number,
  perYear: number,
  sustainedT: number,
) {
  const f4 = (v: number) => parseFloat(v.toFixed(4))
  const coefs = fit.beta
    .map(
      (b, i) =>
        `    ${(names[i] + ':').padEnd(14)} { beta: ${String(f4(b))}, t: ${String(f4(fit.tstat[i]))} }`,
    )
    .join('\n')
  const summary = `model:
  n_obs: ${String(fit.n)}
  r_squared: ${String(f4(fit.rSquared))}
  coefficients:
${coefs}
  sustained_10bps_effect:
    pct_per_month: ${String(f4(perMonth))}
    pct_per_year: ${String(f4(perYear))}
    t: ${String(f4(sustainedT))}`
  console.log('\n' + summary)
}

void main()
