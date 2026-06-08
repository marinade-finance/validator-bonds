#!/usr/bin/env bun
/* eslint-disable import/no-extraneous-dependencies */
import * as fs from 'node:fs'
import * as path from 'node:path'

import sharp from 'sharp'
import * as vega from 'vega'
import { compile } from 'vega-lite'

import type { TopLevelSpec } from 'vega-lite'

const CACHE = './tmp/model-apy-cache.json'
const OUT = './report/model-apy-premium-tvl-impact.png'
const useCache = process.argv.includes('--cache')

// ── API shapes ────────────────────────────────────────────────────────────────

type EpochApyEntry = { epoch: number; time: number; apy: number }
type EpochApyResponse = { epochs: EpochApyEntry[] }
type TvlEntry = { date: number; totalLiquidityUSD: number }
type TvlResponse = { tvl: TvlEntry[] }
type PricePoint = { timestamp: number; price: number }
type PriceResponse = {
  coins: { 'coingecko:solana': { prices: PricePoint[] } }
}

type CacheData = {
  native: EpochApyEntry[]
  ssr: EpochApyEntry[]
  tvl: TvlEntry[]
  prices: PricePoint[]
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${String(r.status)} fetching ${url}`)
  return r.json() as Promise<T>
}

async function loadData(): Promise<CacheData> {
  if (useCache && fs.existsSync(CACHE)) {
    console.log('using cache →', CACHE)
    return JSON.parse(fs.readFileSync(CACHE, 'utf8')) as CacheData
  }
  console.log('fetching data...')
  // Price API caps at 500 points; epoch data spans ~930 days so fetch in two halves
  const priceUrl = (start: number) =>
    `https://coins.llama.fi/chart/coingecko:solana?start=${String(start)}&span=450&period=1d&searchWidth=600`
  const [nativeResp, ssrResp, tvlResp, price1Resp, price2Resp] =
    await Promise.all([
      fetchJson<EpochApyResponse>(
        'https://apy.marinade.finance/v1/epoch-apy/marinade-native',
      ),
      fetchJson<EpochApyResponse>(
        'https://apy.marinade.finance/v1/epoch-apy/ssr',
      ),
      fetchJson<TvlResponse>('https://api.llama.fi/protocol/marinade-native'),
      fetchJson<PriceResponse>(priceUrl(1699000000)),
      fetchJson<PriceResponse>(priceUrl(1738000000)),
    ])
  const data: CacheData = {
    native: nativeResp.epochs,
    ssr: ssrResp.epochs,
    tvl: tvlResp.tvl,
    prices: [
      ...price1Resp.coins['coingecko:solana'].prices,
      ...price2Resp.coins['coingecko:solana'].prices,
    ],
  }
  fs.mkdirSync(path.dirname(CACHE), { recursive: true })
  fs.writeFileSync(CACHE, JSON.stringify(data))
  console.log('cached →', CACHE)
  return data
}

// ── Data joining ──────────────────────────────────────────────────────────────

type EpochRow = {
  epoch: number
  time: number
  marinade: number
  ssr: number
  premium_bps: number
  tvl_usd: number
  sol_price: number
  tvl_sol: number
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

function joinData(data: CacheData): EpochRow[] {
  const ssrMap = new Map(data.ssr.map(e => [e.epoch, e.apy]))
  const rows: EpochRow[] = []
  const maxDelta = 3 * 86400

  for (const ep of data.native) {
    const ssr = ssrMap.get(ep.epoch)
    if (ssr == null) continue
    const tvlEntry = nearest(data.tvl, ep.time, v => v.date, maxDelta)
    const priceEntry = nearest(data.prices, ep.time, v => v.timestamp, maxDelta)
    if (!tvlEntry || !priceEntry) continue
    const solPrice = priceEntry.price
    const tvlUsd = tvlEntry.totalLiquidityUSD
    rows.push({
      epoch: ep.epoch,
      time: ep.time,
      marinade: ep.apy,
      ssr,
      premium_bps: (ep.apy - ssr) * 10000,
      tvl_usd: tvlUsd,
      sol_price: solPrice,
      tvl_sol: tvlUsd / solPrice,
    })
  }

  rows.sort((a, b) => a.epoch - b.epoch)
  return rows
}

// ── Rolling average ───────────────────────────────────────────────────────────

function rollingAvg(rows: EpochRow[], windowDays: number): (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(rows.length).fill(
    null,
  )
  for (let i = 0; i < rows.length; i++) {
    const tEnd = rows[i].time
    const tStart = tEnd - windowDays * 86400
    let sum = 0
    let cnt = 0
    for (let j = i; j >= 0 && rows[j].time >= tStart; j--) {
      sum += rows[j].premium_bps
      cnt++
    }
    if (cnt > 0) out[i] = sum / cnt
  }
  return out
}

// ── OLS regression ────────────────────────────────────────────────────────────

type OlsResult = {
  beta: number[]
  se: number[]
  tstat: number[]
  rSquared: number
  n: number
}

function ols(X: number[][], y: number[]): OlsResult {
  const n = y.length
  const k = X[0].length

  // X'X
  const XtX: number[][] = Array.from({ length: k }, () =>
    new Array<number>(k).fill(0),
  )
  for (let i = 0; i < n; i++)
    for (let a = 0; a < k; a++)
      for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b]

  // X'y
  const Xty: number[] = new Array<number>(k).fill(0)
  for (let i = 0; i < n; i++)
    for (let a = 0; a < k; a++) Xty[a] += X[i][a] * y[i]

  // Invert XtX via Gauss-Jordan
  const inv = invertMatrix(XtX)

  // beta = inv(X'X) * X'y
  const beta: number[] = new Array<number>(k).fill(0)
  for (let a = 0; a < k; a++)
    for (let b = 0; b < k; b++) beta[a] += inv[a][b] * Xty[b]

  // Residuals, RSS, R²
  const yhat = X.map(row => row.reduce((s, v, j) => s + v * beta[j], 0))
  const ybar = y.reduce((s, v) => s + v, 0) / n
  let rss = 0
  let tss = 0
  for (let i = 0; i < n; i++) {
    rss += (y[i] - yhat[i]) ** 2
    tss += (y[i] - ybar) ** 2
  }
  const s2 = rss / (n - k)
  const se = inv.map((row, a) => Math.sqrt(s2 * row[a]))
  const tstat = beta.map((b, a) => b / se[a])
  return { beta, se, tstat, rSquared: 1 - rss / tss, n }
}

function invertMatrix(m: number[][]): number[][] {
  const n = m.length
  const aug: number[][] = m.map((row, i) => {
    const r = [...row]
    for (let j = 0; j < n; j++) r.push(j === i ? 1 : 0)
    return r
  })
  for (let col = 0; col < n; col++) {
    // Pivot
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

// ── AR(1) fit ─────────────────────────────────────────────────────────────────

function fitAr1(series: number[]): number {
  const y = series.slice(1)
  const x = series.slice(0, -1)
  const n = y.length
  const xbar = x.reduce((s, v) => s + v, 0) / n
  const ybar = y.reduce((s, v) => s + v, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (x[i] - xbar) * (y[i] - ybar)
    den += (x[i] - xbar) ** 2
  }
  return num / den
}

// ── Autocorrelation ───────────────────────────────────────────────────────────

function autocorr(series: number[], maxLag: number): number[] {
  const n = series.length
  const mean = series.reduce((s, v) => s + v, 0) / n
  const denom = series.reduce((s, v) => s + (v - mean) ** 2, 0)
  return Array.from({ length: maxLag }, (_, lag) => {
    let num = 0
    for (let i = lag + 1; i < n; i++)
      num += (series[i] - mean) * (series[i - lag - 1] - mean)
    return num / denom
  })
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const data = await loadData()
  const rows = joinData(data)
  if (rows.length < 10)
    throw new Error(`too few joined rows: ${String(rows.length)}`)

  // Rolling avg
  const roll4w = rollingAvg(rows, 28)

  // Build regression dataset: need rows[t], rows[t-1], rows[t-2] and tvl[t], tvl[t-1]
  type RegRow = {
    dLogTvl: number
    premium0: number
    premium1: number
    premium2: number
    dLogSol: number
    solPrice: number
    time: number
    epoch: number
  }
  const regRows: RegRow[] = []
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i]
    const r1 = rows[i - 1]
    const r2 = rows[i - 2]
    if (r.tvl_sol <= 0 || r1.tvl_sol <= 0) continue
    if (r.sol_price <= 0 || r1.sol_price <= 0) continue
    regRows.push({
      dLogTvl: Math.log(r.tvl_sol) - Math.log(r1.tvl_sol),
      premium0: r.premium_bps,
      premium1: r1.premium_bps,
      premium2: r2.premium_bps,
      dLogSol: Math.log(r.sol_price) - Math.log(r1.sol_price),
      solPrice: r.sol_price,
      time: r.time,
      epoch: r.epoch,
    })
  }

  // OLS
  const X = regRows.map(r => [1, r.premium0, r.premium1, r.premium2, r.dLogSol])
  const y = regRows.map(r => r.dLogTvl)
  const fit = ols(X, y)
  const [b0, b1, b2, b3, b4] = fit.beta
  const [se0, se1, se2, se3, se4] = fit.se
  const [t0, t1, t2, t3, t4] = fit.tstat

  // AR(1) on premium
  const premiums = rows.map(r => r.premium_bps)
  const phi = fitAr1(premiums)

  // Autocorrelation
  const acf = autocorr(premiums, 12)

  // Impulse response: +100bps shock at t=0, 30 epochs
  const shock = 100
  const irf: { epoch: number; cumLogTvl: number }[] = []
  let cum = 0
  let p0 = shock
  let p1 = 0
  let p2 = 0
  for (let t = 0; t < 30; t++) {
    const dLog = b1 * p0 + b2 * p1 + b3 * p2
    cum += dLog
    irf.push({ epoch: t, cumLogTvl: cum })
    p2 = p1
    p1 = p0
    p0 = shock * phi ** (t + 1)
  }
  const irfFinal = irf[irf.length - 1].cumLogTvl

  // SOL price quartile coloring for scatter
  const prices = regRows.map(r => r.solPrice).sort((a, b) => a - b)
  const q25 = prices[Math.floor(prices.length * 0.25)]
  const q50 = prices[Math.floor(prices.length * 0.5)]
  const q75 = prices[Math.floor(prices.length * 0.75)]
  const priceQuartile = (p: number) => {
    if (p < q25) return 'Q1 (low)'
    if (p < q50) return 'Q2'
    if (p < q75) return 'Q3'
    return 'Q4 (high)'
  }

  // OLS regression line for scatter (x range)
  const pMin = Math.min(...regRows.map(r => r.premium0))
  const pMax = Math.max(...regRows.map(r => r.premium0))
  const olsLine = [
    { premium: pMin, dLogTvl: b0 + b1 * pMin },
    { premium: pMax, dLogTvl: b0 + b1 * pMax },
  ]

  // Build chart data arrays
  const tvlData = rows.map(r => ({
    epoch: r.epoch,
    tvl_sol_m: r.tvl_sol / 1e6,
  }))

  type ScatterPt = { premium: number; dLogTvl: number; priceQ: string }
  const scatterData: ScatterPt[] = regRows.map(r => ({
    premium: r.premium0,
    dLogTvl: r.dLogTvl,
    priceQ: priceQuartile(r.solPrice),
  }))

  type AcfPt = { lag: number; acf: number; sig: boolean }
  const sigBand = 2 / Math.sqrt(rows.length)
  const acfData: AcfPt[] = acf.map((v, i) => ({
    lag: i + 1,
    acf: v,
    sig: Math.abs(v) > sigBand,
  }))
  const acfBands = [
    { y: sigBand, label: '+2/√n' },
    { y: -sigBand, label: '-2/√n' },
  ]

  const C_PREMIUM = '#4682b4'
  const C_ROLL = '#e07b39'
  const C_TVL = '#2e8b57'
  const C_Q1 = '#7b68ee'
  const C_Q2 = '#4682b4'
  const C_Q3 = '#e09b20'
  const C_Q4 = '#c94040'
  const C_OLS = '#333'
  const C_ACF_SIG = '#c94040'
  const C_ACF_INSIG = '#999'
  const C_IRF = '#2e8b57'

  const epochMin = rows[0].epoch
  const epochMax = rows[rows.length - 1].epoch
  const title = `Marinade Native APY Premium vs TVL · Epochs ${String(epochMin)}–${String(epochMax)}`

  const spec: TopLevelSpec = {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    title: { text: title, fontSize: 15, fontWeight: 'bold', offset: 10 },
    background: 'white',
    config: {
      view: { stroke: null },
      axis: {
        grid: true,
        gridOpacity: 0.3,
        labelFontSize: 11,
        titleFontSize: 12,
      },
      legend: { labelFontSize: 11, symbolStrokeWidth: 2, symbolSize: 200 },
    },
    spacing: 36,
    vconcat: [
      // ── Panel 1: APY premium + rolling avg + TVL ──────────────────────────
      {
        width: 1300,
        height: 260,
        title: {
          text: 'Marinade Native APY Premium vs SSR and TVL',
          fontSize: 13,
        },
        resolve: { scale: { y: 'independent' } },
        layer: [
          // Premium bars
          {
            data: {
              values: rows.map(r => ({ epoch: r.epoch, value: r.premium_bps })),
            },
            mark: { type: 'bar', color: C_PREMIUM, opacity: 0.45 },
            encoding: {
              x: {
                field: 'epoch',
                type: 'quantitative',
                title: 'Epoch',
                axis: { format: 'd' },
              },
              y: {
                field: 'value',
                type: 'quantitative',
                title: 'APY Premium (bps)',
                axis: { labelColor: C_PREMIUM, titleColor: C_PREMIUM },
              },
            },
          },
          // Rolling avg line
          {
            data: {
              values: rows
                .map((r, i) => ({ epoch: r.epoch, value: roll4w[i] }))
                .filter(d => d.value != null),
            },
            mark: { type: 'line', color: C_ROLL, strokeWidth: 2.5 },
            encoding: {
              x: { field: 'epoch', type: 'quantitative' },
              y: { field: 'value', type: 'quantitative' },
            },
          },
          // TVL line (right axis)
          {
            data: { values: tvlData },
            mark: {
              type: 'line',
              color: C_TVL,
              strokeWidth: 2,
              strokeDash: [4, 2],
            },
            encoding: {
              x: { field: 'epoch', type: 'quantitative' },
              y: {
                field: 'tvl_sol_m',
                type: 'quantitative',
                title: 'TVL (M SOL)',
                axis: { labelColor: C_TVL, titleColor: C_TVL, orient: 'right' },
              },
            },
          },
        ],
      },
      // ── Panels 2 + 3 side by side ─────────────────────────────────────────
      {
        spacing: 40,
        resolve: { color: { scale: 'independent', legend: 'independent' } },
        hconcat: [
          // ── Panel 2: Scatter premium vs ΔlogTVL ────────────────────────────
          {
            width: 600,
            height: 300,
            title: { text: 'APY Premium → TVL Change', fontSize: 13 },
            layer: [
              {
                data: { values: scatterData },
                mark: { type: 'point', size: 50, opacity: 0.7 },
                encoding: {
                  x: {
                    field: 'premium',
                    type: 'quantitative',
                    title: 'APY Premium (bps)',
                  },
                  y: {
                    field: 'dLogTvl',
                    type: 'quantitative',
                    title: 'ΔlogTVL (SOL)',
                  },
                  color: {
                    field: 'priceQ',
                    type: 'nominal',
                    title: 'SOL price quartile',
                    scale: {
                      domain: ['Q1 (low)', 'Q2', 'Q3', 'Q4 (high)'],
                      range: [C_Q1, C_Q2, C_Q3, C_Q4],
                    },
                    legend: {
                      orient: 'bottom',
                      direction: 'horizontal',
                      title: 'SOL price quartile',
                    },
                  },
                },
              },
              {
                data: { values: olsLine },
                mark: {
                  type: 'line',
                  color: C_OLS,
                  strokeWidth: 2,
                  strokeDash: [6, 3],
                },
                encoding: {
                  x: { field: 'premium', type: 'quantitative' },
                  y: { field: 'dLogTvl', type: 'quantitative' },
                },
              },
            ],
          },
          // ── Panel 3: Autocorrelation ───────────────────────────────────────
          {
            width: 600,
            height: 300,
            title: {
              text: 'APY Premium Persistence (autocorrelation)',
              fontSize: 13,
            },
            layer: [
              {
                data: { values: acfData },
                mark: { type: 'bar', size: 28 },
                encoding: {
                  x: { field: 'lag', type: 'ordinal', title: 'Lag (epochs)' },
                  y: {
                    field: 'acf',
                    type: 'quantitative',
                    title: 'ACF',
                    scale: { domain: [-0.4, 1] },
                  },
                  color: {
                    condition: { test: 'datum.sig', value: C_ACF_SIG },
                    value: C_ACF_INSIG,
                  },
                },
              },
              ...acfBands.map(b => ({
                data: { values: [b] },
                mark: {
                  type: 'rule' as const,
                  strokeDash: [5, 3],
                  strokeWidth: 1.2,
                  color: '#555',
                },
                encoding: {
                  y: { field: 'y', type: 'quantitative' as const },
                },
              })),
            ],
          },
        ],
      },
      // ── Panel 4: Impulse response ─────────────────────────────────────────
      {
        width: 1300,
        height: 220,
        title: {
          text: 'Impulse Response: +100bps Premium Shock',
          fontSize: 13,
        },
        data: { values: irf },
        mark: {
          type: 'area',
          color: C_IRF,
          opacity: 0.6,
          line: { color: C_IRF, strokeWidth: 2 },
        },
        encoding: {
          x: {
            field: 'epoch',
            type: 'quantitative',
            title: 'Epochs after shock',
            axis: { format: 'd' },
          },
          y: {
            field: 'cumLogTvl',
            type: 'quantitative',
            title: 'Cumulative log TVL change',
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

  // ── Model summary YAML ────────────────────────────────────────────────────

  const f4 = (v: number) => parseFloat(v.toFixed(4))
  const summary = `model:
  n_obs: ${String(fit.n)}
  r_squared: ${String(f4(fit.rSquared))}
  coefficients:
    intercept:  { beta: ${String(f4(b0))}, se: ${String(f4(se0))}, t: ${String(f4(t0))} }
    premium_t0: { beta: ${String(f4(b1))}, se: ${String(f4(se1))}, t: ${String(f4(t1))} }
    premium_t1: { beta: ${String(f4(b2))}, se: ${String(f4(se2))}, t: ${String(f4(t2))} }
    premium_t2: { beta: ${String(f4(b3))}, se: ${String(f4(se3))}, t: ${String(f4(t3))} }
    d_log_sol:  { beta: ${String(f4(b4))}, se: ${String(f4(se4))}, t: ${String(f4(t4))} }
  ar1_phi: ${String(f4(phi))}
  impulse_response:
    cumulative_log_tvl_30ep: ${String(f4(irfFinal))}`

  console.log('\n' + summary)
}

void main()
