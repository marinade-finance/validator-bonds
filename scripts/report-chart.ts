#!/usr/bin/env bun
/* eslint-disable import/no-extraneous-dependencies */
import * as fs from 'node:fs'

import sharp from 'sharp'
import * as vega from 'vega'
import { compile } from 'vega-lite'
import { parse as parseYaml } from 'yaml'

import type { TopLevelSpec } from 'vega-lite'

const REPORT = 'report.yml'
const OUT = 'report.png'

const C_ACTUAL = '#4682b4'
const C_REF = '#708090'
const C_CAP = '#2e8b57'
const C_MINFEE = '#9370db'
const C_COST = '#b22222'

type SimYaml = Record<string, string | number>
type EpochYaml = {
  epoch: number
  time: number
  ssr_apy: string
  simulations: SimYaml[] | null
}
type ReportYaml = { epochs: EpochYaml[] }

const S_AT_CAP = 'At cap'
const S_AT_MIN = 'At min fee'
const S_ADJUSTED = 'Adjusted'
const S_MAXFEE = 'Max-fee cap'
const S_SSR = 'SSR baseline'

type Row = {
  epoch: number
  time: number
  month: string
  ssrApy: number
  apyAdj: number
  apyMax: number
  feeAdj: number
  feeMax: number
  vcap: number
  vmin: number
  shortfall: number
}

type ApyPoint = {
  epoch: number
  ssrApy: number
  apyAdj: number
  apyMax: number
}
type FeePoint = { epoch: number; series: string; fee: number }
type ValPoint = { epoch: number; series: string; pct: number }

const pct = (s: string | number): number =>
  parseFloat(String(s).replace('%', ''))

const ratio = (s: string | undefined): number => {
  if (!s) return 0
  const [a, b] = String(s).split('/').map(Number)
  return b ? (a / b) * 100 : 0
}

function load(): Row[] {
  const data = parseYaml(
    fs.readFileSync(REPORT, 'utf8'),
  ) as unknown as ReportYaml
  // Skip epochs the CLI could not simulate (no `simulations` entries).
  return data.epochs.flatMap(e => {
    const sim = e.simulations?.[0]
    if (!sim) return []
    const feeAdj = Number(sim['fee_sol_adj'])
    const feeMax = Number(sim['fee_sol_max'])
    return [
      {
        epoch: e.epoch,
        time: e.time,
        month: new Date(e.time * 1000).toISOString().slice(0, 7),
        ssrApy: pct(e.ssr_apy),
        apyAdj: pct(sim['apy_adj']),
        apyMax: pct(sim['apy_max']),
        feeAdj,
        feeMax,
        vcap: ratio(String(sim['validators_capped'])),
        vmin: ratio(String(sim['validators_at_min_fee'] ?? '0/1')),
        shortfall: feeMax - feeAdj,
      },
    ]
  })
}

async function main() {
  const rows = load()
  const epochs = rows.map(r => r.epoch)
  const totalShortfall = rows.reduce((s, r) => s + r.shortfall, 0)
  const title = `Marinade Validator Bond Fee Simulation · Epochs ${epochs[0]}–${epochs[epochs.length - 1]}`

  // Per-bar value labels only read cleanly when bars are sparse. Above this
  // density the labels collide into illegible mush, so suppress them.
  const showBarLabels = rows.length <= 16

  // Detect gaps in the otherwise-consecutive epoch sequence. The ordinal axis
  // silently connects across missing epochs, so we draw a marker at each gap.
  type Gap = { after: number; before: number; missing: number }
  const gaps: Gap[] = []
  for (let i = 1; i < epochs.length; i++) {
    const missing = epochs[i] - epochs[i - 1] - 1
    if (missing > 0) {
      gaps.push({ after: epochs[i - 1], before: epochs[i], missing })
    }
  }

  // Weekly aggregation: sum feeAdj and shortfall per ISO week (YYYY-Www)
  const isoWeek = (ts: number): string => {
    const d = new Date(ts * 1000)
    const jan4 = new Date(d.getFullYear(), 0, 4)
    const startOfWeek1 = new Date(jan4)
    startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7))
    const diffDays = Math.floor(
      (d.getTime() - startOfWeek1.getTime()) / 86400000,
    )
    const week = Math.floor(diffDays / 7) + 1
    return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`
  }
  const weekMap = new Map<string, { feeAdj: number; shortfall: number }>()
  for (const r of rows) {
    const w = isoWeek(r.time)
    const entry = weekMap.get(w) ?? { feeAdj: 0, shortfall: 0 }
    entry.feeAdj += r.feeAdj
    entry.shortfall += r.shortfall
    weekMap.set(w, entry)
  }
  type WeekRow = { week: string; sol: number }
  const weekDomain = [...weekMap.keys()].sort()
  const weeklyShortfall: WeekRow[] = weekDomain.map(w => ({
    week: w,
    sol: weekMap.get(w)?.shortfall ?? 0,
  }))

  // Missing epochs enumerated from the gaps — null rows inserted at these
  // positions break lines/areas so they don't connect across the gap.
  const missingEpochs: number[] = gaps.flatMap(g => {
    const out: number[] = []
    for (let e = g.after + 1; e < g.before; e++) out.push(e)
    return out
  })

  const apyData: ApyPoint[] = rows.map(r => ({
    epoch: r.epoch,
    ssrApy: r.ssrApy,
    apyAdj: r.apyAdj,
    apyMax: r.apyMax,
  }))
  const feeTidy: FeePoint[] = rows.flatMap(r => [
    { epoch: r.epoch, series: S_ADJUSTED, fee: r.feeAdj },
    { epoch: r.epoch, series: S_MAXFEE, fee: r.feeMax },
  ])

  const valTidy: ValPoint[] = rows.flatMap(r => [
    { epoch: r.epoch, series: S_AT_CAP, pct: r.vcap },
    { epoch: r.epoch, series: S_AT_MIN, pct: r.vmin },
  ])

  // Full consecutive range so missing epochs reserve a slot on the ordinal
  // axis: lines break across the gap and bars are simply absent, rather than
  // the gap being silently collapsed.
  const epochDomain: number[] = []
  for (let e = epochs[0]; e <= epochs[epochs.length - 1]; e++) {
    epochDomain.push(e)
  }

  // With many epochs, every-epoch tick labels overlap; show every Nth.
  const labelStride = Math.ceil(epochDomain.length / 26)
  const labelExpr =
    labelStride > 1
      ? `(datum.value - ${epochs[0]}) % ${labelStride} === 0 ? datum.label : ''`
      : 'datum.label'

  const xEnc = {
    field: 'epoch',
    type: 'ordinal' as const,
    title: null,
    axis: { labelAngle: -45, labelExpr },
    scale: { domain: epochDomain },
  }

  // Tidy APY data for a legend-friendly encoding: one row per (epoch, series).
  // Null rows at missing epochs break the lines so they don't bridge the gap.
  type ApyTidy = { epoch: number; series: string; apy: number | null }
  const apyTidy: ApyTidy[] = [
    ...rows.flatMap(r => [
      { epoch: r.epoch, series: S_SSR, apy: r.ssrApy },
      { epoch: r.epoch, series: S_ADJUSTED, apy: r.apyAdj },
      { epoch: r.epoch, series: S_MAXFEE, apy: r.apyMax },
    ]),
    ...missingEpochs.flatMap(e => [
      { epoch: e, series: S_SSR, apy: null },
      { epoch: e, series: S_ADJUSTED, apy: null },
      { epoch: e, series: S_MAXFEE, apy: null },
    ]),
  ].sort((a, b) => a.epoch - b.epoch)

  // Tight APY y-domain: span the data (all three series) with a small pad so
  // the chart is not mostly empty space below the lowest line.
  const apyVals = rows.flatMap(r => [r.apyAdj, r.apyMax, r.ssrApy])
  const apyLo = Math.floor((Math.min(...apyVals) - 0.1) * 10) / 10
  const apyHi = Math.ceil((Math.max(...apyVals) + 0.1) * 10) / 10
  const apyYScale = { domain: [apyLo, apyHi], nice: false } as const

  // Gap markers for the APY panel: a vertical band over the reserved-but-empty
  // slots plus a label naming the skipped epochs.
  type GapMark = { epoch: number; label: string }
  const gapBands: GapMark[] = gaps.flatMap(g => {
    const out: GapMark[] = []
    const lo = g.after + 1
    const hi = g.before - 1
    const mid = Math.round((lo + hi) / 2)
    for (let e = lo; e <= hi; e++) {
      out.push({
        epoch: e,
        label: e === mid ? `epochs ${lo}–${hi} skipped` : '',
      })
    }
    return out
  })

  // Read max_fee_bps from first sim row if available
  const firstSim = (() => {
    const raw = fs.readFileSync(REPORT, 'utf8')
    const data = parseYaml(raw) as unknown as ReportYaml
    for (const e of data.epochs) {
      if (e.simulations?.[0]) return e.simulations[0]
    }
    return null
  })()
  const maxFeeBps = firstSim?.['max_fee_bps'] ?? 800

  const spec: TopLevelSpec = {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    title: { text: title, fontSize: 15, fontWeight: 'bold', offset: 8 },
    background: 'white',
    config: {
      view: { stroke: null },
      axis: {
        grid: true,
        gridOpacity: 0.35,
        labelFontSize: 11,
        titleFontSize: 12,
      },
      legend: { labelFontSize: 12, symbolStrokeWidth: 3, symbolSize: 320 },
    },
    resolve: { scale: { color: 'independent', strokeDash: 'independent' } },
    spacing: 40,
    vconcat: [
      // ── Panel 1: Post-Fee APY ─────────────────────────────────────────────
      {
        width: 960,
        height: 230,
        title: { text: 'Post-Fee APY vs SSR Baseline', fontSize: 13 },
        layer: [
          // Gap band: shade reserved-but-empty epoch slots so the break in the
          // lines reads as "missing data", not a sudden dip.
          {
            data: { values: gapBands },
            mark: { type: 'rule', color: '#d8a657', opacity: 0.5, size: 6 },
            encoding: { x: xEnc },
          },
          {
            data: { values: gapBands.filter(g => g.label) },
            mark: {
              type: 'text',
              angle: -90,
              fontSize: 9,
              color: '#9a7b2e',
              fontStyle: 'italic',
              baseline: 'middle',
            },
            encoding: {
              x: xEnc,
              y: { value: 55 },
              text: { field: 'label', type: 'nominal' },
            },
          },
          // Green band: adjusted ABOVE SSR — y2 clamped so area collapses when adj < ssr
          {
            data: { values: apyData },
            transform: [
              { calculate: 'max(datum.apyAdj, datum.ssrApy)', as: 'adjCeil' },
            ],
            mark: { type: 'area', opacity: 0.18, color: '#2e8b57' },
            encoding: {
              x: xEnc,
              y: { field: 'adjCeil', type: 'quantitative', scale: apyYScale },
              y2: { field: 'ssrApy' },
            },
          },
          // Red band: adjusted BELOW SSR — y2 clamped so area collapses when adj >= ssr
          {
            data: { values: apyData },
            transform: [
              { calculate: 'min(datum.apyAdj, datum.ssrApy)', as: 'adjFloor' },
            ],
            mark: { type: 'area', opacity: 0.25, color: '#b22222' },
            encoding: {
              x: xEnc,
              y: {
                field: 'ssrApy',
                type: 'quantitative',
                scale: apyYScale,
              },
              y2: { field: 'adjFloor' },
            },
          },
          // SSR baseline — dashed gray
          {
            data: { values: apyTidy.filter(d => d.series === S_SSR) },
            mark: {
              type: 'line',
              strokeDash: [6, 3],
              strokeWidth: 1.8,
              color: '#586573',
            },
            encoding: {
              x: xEnc,
              y: {
                field: 'apy',
                type: 'quantitative',
                title: 'APY %',
                scale: apyYScale,
                axis: { format: '.1f', labelExpr: "datum.label + '%'" },
              },
            },
          },
          // Max-fee cap — dotted light gray
          {
            data: { values: apyTidy.filter(d => d.series === S_MAXFEE) },
            mark: {
              type: 'line',
              strokeDash: [2, 3],
              strokeWidth: 1.5,
              color: '#c2c8cf',
            },
            encoding: {
              x: xEnc,
              y: { field: 'apy', type: 'quantitative', scale: apyYScale },
            },
          },
          // Adjusted — solid blue with points (main series)
          {
            data: { values: apyTidy.filter(d => d.series === S_ADJUSTED) },
            mark: {
              type: 'line',
              strokeWidth: 2.5,
              color: C_ACTUAL,
              point: { filled: true, size: 35, color: C_ACTUAL },
            },
            encoding: {
              x: xEnc,
              y: { field: 'apy', type: 'quantitative', scale: apyYScale },
            },
          },
          // Legend proxy — drives a single merged color+dash legend below the
          // panel. Encoding both `color` and `strokeDash` on the same field
          // makes the legend symbols mirror the real line styles: solid blue,
          // dashed gray, dotted light gray.
          {
            data: { values: apyTidy },
            mark: { type: 'line', opacity: 0 },
            encoding: {
              x: xEnc,
              y: { field: 'apy', type: 'quantitative' },
              color: {
                field: 'series',
                sort: [S_ADJUSTED, S_SSR, S_MAXFEE],
                scale: {
                  domain: [S_ADJUSTED, S_SSR, S_MAXFEE],
                  range: [C_ACTUAL, '#586573', '#c2c8cf'],
                },
                legend: {
                  title: null,
                  orient: 'bottom',
                  direction: 'horizontal',
                  offset: 16,
                  labelFontSize: 13,
                  symbolType: 'stroke',
                  symbolSize: 900,
                  symbolStrokeWidth: 3.5,
                },
              },
              strokeDash: {
                field: 'series',
                sort: [S_ADJUSTED, S_SSR, S_MAXFEE],
                scale: {
                  domain: [S_ADJUSTED, S_SSR, S_MAXFEE],
                  range: [
                    [1, 0],
                    [6, 3],
                    [2, 3],
                  ],
                },
                legend: {
                  title: null,
                  orient: 'bottom',
                  direction: 'horizontal',
                  offset: 16,
                  labelFontSize: 13,
                  symbolType: 'stroke',
                  symbolSize: 900,
                  symbolStrokeWidth: 3.5,
                },
              },
            },
          },
          // Labels: first, last, min, max of adjusted
          {
            data: {
              values: (() => {
                const adj = apyData
                const minV = Math.min(...adj.map(d => d.apyAdj))
                const maxV = Math.max(...adj.map(d => d.apyAdj))
                return adj.filter(
                  (d, i) =>
                    i === 0 ||
                    i === adj.length - 1 ||
                    d.apyAdj === minV ||
                    d.apyAdj === maxV,
                )
              })(),
            },
            mark: {
              type: 'text',
              dy: -11,
              fontSize: 9,
              fontWeight: 'bold',
              color: C_ACTUAL,
            },
            encoding: {
              x: xEnc,
              y: { field: 'apyAdj', type: 'quantitative' },
              text: { field: 'apyAdj', type: 'quantitative', format: '.2f' },
            },
          },
        ],
      },
      // ── Panel 2: Fee Extraction ───────────────────────────────────────────
      {
        width: 960,
        height: 210,
        title: { text: 'Marinade Fee Extraction (SOL)', fontSize: 13 },
        data: { values: feeTidy },
        layer: [
          {
            mark: { type: 'bar', opacity: 0.85 },
            encoding: {
              x: xEnc,
              xOffset: { field: 'series', sort: [S_ADJUSTED, S_MAXFEE] },
              y: { field: 'fee', type: 'quantitative', title: 'SOL' },
              color: {
                field: 'series',
                scale: {
                  domain: [S_ADJUSTED, S_MAXFEE],
                  range: [C_ACTUAL, C_REF],
                },
                legend: {
                  title: null,
                  orient: 'right',
                  direction: 'vertical',
                  symbolType: 'square',
                  symbolSize: 220,
                },
              },
            },
          },
          // Labels on both bar series (only when sparse enough to read)
          ...(showBarLabels
            ? [
                {
                  mark: {
                    type: 'text' as const,
                    dy: -5,
                    fontSize: 8,
                    color: '#333',
                  },
                  encoding: {
                    x: xEnc,
                    xOffset: { field: 'series', sort: [S_ADJUSTED, S_MAXFEE] },
                    y: { field: 'fee', type: 'quantitative' as const },
                    text: {
                      field: 'fee',
                      type: 'quantitative' as const,
                      format: '.0f',
                    },
                  },
                },
              ]
            : []),
        ],
      },
      // ── Panel 3a + 3b: Validators & Shortfall ────────────────────────────
      {
        width: 960,
        height: 190,
        title: { text: 'Validators at Cap / at Min Fee (%)', fontSize: 13 },
        data: { values: valTidy },
        layer: [
          // Lines with points
          {
            mark: {
              type: 'line',
              strokeWidth: 2,
              point: { filled: true, size: 35 },
            },
            encoding: {
              x: xEnc,
              y: {
                field: 'pct',
                type: 'quantitative',
                title: '% of validators',
                scale: { domain: [0, 115] },
                axis: { format: 'd', labelExpr: "datum.label + '%'" },
              },
              color: {
                field: 'series',
                scale: {
                  domain: [S_AT_CAP, S_AT_MIN],
                  range: [C_CAP, C_MINFEE],
                },
                legend: {
                  title: null,
                  orient: 'bottom',
                  direction: 'horizontal',
                  offset: 12,
                  symbolType: 'circle',
                  symbolSize: 140,
                },
              },
            },
          },
          // 100% reference line
          {
            mark: {
              type: 'rule',
              color: '#888',
              strokeWidth: 1,
              strokeDash: [4, 3],
            },
            encoding: { y: { datum: 100 } },
          },
        ],
      },
      // ── Panel 4: Weekly Shortfall ─────────────────────────────────────────
      {
        width: 960,
        height: 140,
        title: {
          text: `Weekly Fee Shortfall vs Max-Fee (SOL)  [Σ ${totalShortfall.toFixed(0)} SOL]`,
          fontSize: 13,
        },
        data: { values: weeklyShortfall },
        layer: [
          {
            mark: { type: 'bar', color: C_COST, opacity: 0.8 },
            encoding: {
              x: {
                field: 'week',
                type: 'ordinal',
                title: null,
                axis: { labelAngle: -30 },
                scale: { domain: weekDomain },
              },
              y: { field: 'sol', type: 'quantitative', title: 'SOL' },
            },
          },
          {
            mark: { type: 'text', dy: -5, fontSize: 8.5, color: '#333' },
            encoding: {
              x: {
                field: 'week',
                type: 'ordinal',
                scale: { domain: weekDomain },
              },
              y: { field: 'sol', type: 'quantitative' },
              text: { field: 'sol', type: 'quantitative', format: '.0f' },
            },
          },
        ],
      },
      // ── Footer ────────────────────────────────────────────────────────────
      {
        width: 960,
        height: 1,
        view: { stroke: null },
        data: { values: [{}] },
        mark: {
          type: 'text',
          text: `max_fee_bps = ${String(maxFeeBps)} · source: report.yml`,
          color: '#999',
          fontSize: 9,
          align: 'center',
        },
        encoding: { x: { value: 480 } },
      },
    ],
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const vegaSpec = compile(spec).spec
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  const view = new vega.View(vega.parse(vegaSpec), { renderer: 'none' })
  const svg = await view.toSVG()
  await sharp(Buffer.from(svg)).png().toFile(OUT)
  console.log(`saved → ${OUT}`)
}

void main()
