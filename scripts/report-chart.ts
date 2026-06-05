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
const S_SPREAD = 'Adj–Max spread'

type Row = {
  epoch: number
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

  const epochDomain = epochs

  const xEnc = {
    field: 'epoch',
    type: 'ordinal' as const,
    title: null,
    axis: { labelAngle: -45 },
    scale: { domain: epochDomain },
  }

  const apyColorScale = {
    domain: [S_SSR, S_ADJUSTED, S_MAXFEE, S_SPREAD],
    range: [C_REF, C_ACTUAL, C_REF, C_ACTUAL],
  }
  const apyLegend = {
    field: 'k',
    type: 'nominal' as const,
    scale: apyColorScale,
    legend: {
      title: null,
      orient: 'bottom-left' as const,
      direction: 'horizontal' as const,
    },
  }

  const spec: TopLevelSpec = {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    title: { text: title, fontSize: 15, fontWeight: 'bold' },
    background: 'white',
    config: { view: { stroke: null }, axis: { grid: true, gridOpacity: 0.4 } },
    resolve: { scale: { color: 'independent' } },
    vconcat: [
      {
        width: 960,
        height: 240,
        title: 'Post-Fee APY  (adjusted · SSR baseline · max-fee cap)',
        encoding: { x: xEnc },
        layer: [
          {
            data: { values: apyData },
            mark: { type: 'area', opacity: 0.08, color: C_ACTUAL },
            encoding: {
              y: { field: 'apyAdj', type: 'quantitative' },
              y2: { field: 'apyMax' },
              color: { datum: S_SPREAD, ...apyLegend },
            },
          },
          {
            data: { values: apyData },
            mark: { type: 'line', strokeDash: [4, 2], strokeWidth: 1.8 },
            encoding: {
              y: {
                field: 'ssrApy',
                type: 'quantitative',
                title: 'APY %',
                scale: { zero: false },
                axis: { format: '.2f', labelExpr: "datum.label + '%'" },
              },
              color: { datum: S_SSR, ...apyLegend },
            },
          },
          {
            data: { values: apyData },
            mark: { type: 'line', strokeWidth: 2.5 },
            encoding: {
              y: {
                field: 'apyAdj',
                type: 'quantitative',
                title: 'APY %',
                scale: { zero: false },
              },
              color: { datum: S_ADJUSTED, ...apyLegend },
            },
          },
          {
            data: { values: apyData },
            mark: { type: 'line', strokeDash: [2, 2], strokeWidth: 1.5 },
            encoding: {
              y: {
                field: 'apyMax',
                type: 'quantitative',
                title: 'APY %',
                scale: { zero: false },
              },
              color: { datum: S_MAXFEE, ...apyLegend },
            },
          },
          {
            data: { values: apyData },
            mark: { type: 'text', dy: -8, fontSize: 8, color: C_ACTUAL },
            encoding: {
              y: { field: 'apyAdj', type: 'quantitative' },
              text: { field: 'apyAdj', type: 'quantitative', format: '.2f' },
            },
          },
        ],
      },
      {
        width: 960,
        height: 240,
        title: 'Marinade Fee Extraction (SOL)',
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
                legend: { title: null, orient: 'top-right' },
              },
            },
          },
          {
            transform: [{ filter: `datum.series === '${S_ADJUSTED}'` }],
            mark: { type: 'text', dy: -4, fontSize: 8, color: 'black' },
            encoding: {
              x: xEnc,
              xOffset: { field: 'series', sort: [S_ADJUSTED, S_MAXFEE] },
              y: { field: 'fee', type: 'quantitative' },
              text: { field: 'fee', type: 'quantitative', format: '.0f' },
            },
          },
        ],
      },
      {
        hconcat: [
          {
            width: 440,
            height: 170,
            title: 'Validators at Cap / at Min Fee (%)',
            data: { values: valTidy },
            layer: [
              {
                mark: { type: 'area', opacity: 0.1 },
                encoding: {
                  x: xEnc,
                  y: {
                    field: 'pct',
                    type: 'quantitative',
                    title: '%',
                    scale: { domain: [0, 115] },
                    axis: { labelExpr: "datum.label + '%'" },
                  },
                  color: {
                    field: 'series',
                    scale: {
                      domain: [S_AT_CAP, S_AT_MIN],
                      range: [C_CAP, C_MINFEE],
                    },
                    legend: { title: null, orient: 'top-right' },
                  },
                },
              },
              {
                mark: {
                  type: 'line',
                  strokeWidth: 2,
                  point: { filled: true, size: 25 },
                },
                encoding: {
                  x: xEnc,
                  y: {
                    field: 'pct',
                    type: 'quantitative',
                    title: '%',
                    scale: { domain: [0, 115] },
                  },
                  color: {
                    field: 'series',
                    scale: {
                      domain: [S_AT_CAP, S_AT_MIN],
                      range: [C_CAP, C_MINFEE],
                    },
                    legend: { title: null, orient: 'top-right' },
                  },
                },
              },
              {
                mark: {
                  type: 'rule',
                  color: 'gray',
                  strokeWidth: 0.8,
                  strokeDash: [2, 2],
                },
                encoding: { y: { datum: 100 } },
              },
            ],
          },
          {
            width: 440,
            height: 170,
            title: `Shortfall vs Max Fee (SOL)  [total: ${totalShortfall.toFixed(0)} SOL]`,
            data: { values: rows },
            layer: [
              {
                mark: { type: 'bar', color: C_COST, opacity: 0.8 },
                encoding: {
                  x: xEnc,
                  y: { field: 'shortfall', type: 'quantitative', title: 'SOL' },
                },
              },
              {
                mark: { type: 'text', dy: -4, fontSize: 8, color: 'black' },
                encoding: {
                  x: xEnc,
                  y: { field: 'shortfall', type: 'quantitative' },
                  text: {
                    field: 'shortfall',
                    type: 'quantitative',
                    format: '.0f',
                  },
                },
              },
            ],
          },
        ],
      },
      {
        width: 960,
        height: 1,
        view: { stroke: null },
        data: { values: [{}] },
        mark: {
          type: 'text',
          text: 'max_fee_bps = 800 · source: report.yml',
          color: 'gray',
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
