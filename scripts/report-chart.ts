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
type EpochYaml = { epoch: number; ssr_apy: string; simulations: SimYaml[] }
type ReportYaml = { epochs: EpochYaml[] }

const S_AT_CAP = 'At cap'
const S_AT_MIN = 'At min fee'
const S_ADJUSTED = 'Adjusted'
const S_MAXFEE = 'Max-fee cap'

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
  return data.epochs.map(e => {
    const sim = e.simulations[0]
    const feeAdj = Number(sim['fee_sol_adj'])
    const feeMax = Number(sim['fee_sol_max'])
    return {
      epoch: e.epoch,
      ssrApy: pct(e.ssr_apy),
      apyAdj: pct(sim['apy_adj']),
      apyMax: pct(sim['apy_max']),
      feeAdj,
      feeMax,
      vcap: ratio(String(sim['validators_capped'])),
      vmin: ratio(String(sim['validators_at_min_fee'] ?? '0/1')),
      shortfall: feeMax - feeAdj,
    }
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

  const epochDomain = epochs.map(String)

  const spec: TopLevelSpec = {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    title: { text: title, fontSize: 15, fontWeight: 'bold' },
    background: 'white',
    config: { view: { stroke: null }, axis: { grid: true, gridOpacity: 0.4 } },
    vconcat: [
      {
        width: 960,
        height: 200,
        title: 'Post-Fee APY  (adjusted · SSR baseline · max-fee cap)',
        encoding: {
          x: {
            field: 'epoch',
            type: 'ordinal',
            axis: { labelAngle: -45 },
            scale: { domain: epochDomain },
          },
        },
        layer: [
          {
            data: { values: apyData },
            mark: { type: 'area', opacity: 0.08, color: C_ACTUAL },
            encoding: {
              y: { field: 'apyAdj', type: 'quantitative' },
              y2: { field: 'apyMax' },
            },
          },
          {
            data: { values: apyData },
            mark: {
              type: 'line',
              strokeDash: [4, 2],
              color: C_REF,
              strokeWidth: 1.8,
            },
            encoding: {
              y: { field: 'ssrApy', type: 'quantitative', title: 'APY %' },
            },
          },
          {
            data: { values: apyData },
            mark: { type: 'line', color: C_ACTUAL, strokeWidth: 2.5 },
            encoding: {
              y: { field: 'apyAdj', type: 'quantitative', title: 'APY %' },
            },
          },
          {
            data: { values: apyData },
            mark: {
              type: 'line',
              strokeDash: [2, 2],
              color: C_REF,
              strokeWidth: 1.5,
            },
            encoding: {
              y: { field: 'apyMax', type: 'quantitative', title: 'APY %' },
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
        height: 200,
        title: 'Marinade Fee Extraction (SOL)',
        data: { values: feeTidy },
        mark: { type: 'bar', opacity: 0.85 },
        encoding: {
          x: {
            field: 'epoch',
            type: 'ordinal',
            axis: { labelAngle: -45 },
            scale: { domain: epochDomain },
          },
          xOffset: { field: 'series', sort: [S_ADJUSTED, S_MAXFEE] },
          y: { field: 'fee', type: 'quantitative', title: 'SOL' },
          color: {
            field: 'series',
            scale: { domain: [S_ADJUSTED, S_MAXFEE], range: [C_ACTUAL, C_REF] },
            legend: { title: null },
          },
        },
      },
      {
        hconcat: [
          {
            width: 460,
            height: 150,
            title: 'Validators at Cap / at Min Fee (%)',
            data: { values: valTidy },
            layer: [
              {
                mark: { type: 'area', opacity: 0.1 },
                encoding: {
                  x: {
                    field: 'epoch',
                    type: 'ordinal',
                    axis: { labelAngle: -45 },
                    scale: { domain: epochDomain },
                  },
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
                    legend: { title: null },
                  },
                },
              },
              {
                mark: {
                  type: 'line',
                  strokeWidth: 2,
                  point: { filled: true, size: 20 },
                },
                encoding: {
                  x: {
                    field: 'epoch',
                    type: 'ordinal',
                    axis: { labelAngle: -45 },
                    scale: { domain: epochDomain },
                  },
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
                    legend: { title: null },
                  },
                },
              },
            ],
          },
          {
            width: 460,
            height: 150,
            title: `Shortfall vs Max Fee (SOL)  [total: ${totalShortfall.toFixed(0)} SOL]`,
            data: { values: rows },
            mark: { type: 'bar', color: C_COST, opacity: 0.8 },
            encoding: {
              x: {
                field: 'epoch',
                type: 'ordinal',
                axis: { labelAngle: -45 },
                scale: { domain: epochDomain },
              },
              y: { field: 'shortfall', type: 'quantitative', title: 'SOL' },
            },
          },
        ],
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
