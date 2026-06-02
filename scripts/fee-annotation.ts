/* eslint-disable n/no-process-exit */

import { readFileSync } from 'node:fs'

import { parse } from 'yaml'

type Settlement = {
  reason: string
  details: {
    total_marinade_active_stake: number
    total_marinade_stakers_rewards: string
    marinade_fee_claim: number
    dao_fee_claim: number
  } | null
}

type BidSettlement = Settlement & {
  details: NonNullable<Settlement['details']>
}

type SsrFeed = { epochs: { epoch: number; time: number }[] }

const SECONDS_PER_YEAR = 365.25 * 24 * 60 * 60 // Julian year

async function main() {
  const [settlementsFile, configFile = './settlement-config.yaml'] =
    process.argv.slice(2)
  if (!settlementsFile) {
    process.stderr.write(
      'Usage: tsx scripts/fee-annotation.ts <settlements.json> [settlement-config.yaml]\n',
    )
    process.exit(2)
  }

  const apyUrl = process.env.APY_API_URL ?? 'https://apy.marinade.finance'

  const cfg = parse(readFileSync(configFile, 'utf8')) as {
    fee_config: { max_fee_bps: number; min_fee_bps: number }
  }
  if (!cfg?.fee_config) {
    process.stderr.write(`Failed: fee_config missing in ${configFile}\n`)
    process.exit(1)
  }
  const maxFeeBps = cfg.fee_config.max_fee_bps
  const minFeeBps = cfg.fee_config.min_fee_bps

  const { epoch, settlements } = JSON.parse(
    readFileSync(settlementsFile, 'utf8'),
  ) as {
    epoch: number
    settlements: Settlement[]
  }

  const bids = settlements.filter(
    (s): s is BidSettlement => s.reason === 'Bidding' && s.details !== null,
  )
  const stake = bids.reduce(
    (s, b) => s + b.details.total_marinade_active_stake,
    0,
  )

  if (bids.length === 0 || stake === 0) {
    process.stdout.write(
      `### Fee Report — Epoch ${epoch}\nNo Bidding settlements found.\n`,
    )
    return
  }

  // gross and stake: Bidding-only — PriorityFee has null stakers_rewards and null stake
  const gross = bids.reduce(
    (s, b) => s + parseFloat(b.details.total_marinade_stakers_rewards),
    0,
  )
  // fees: all settlement types — PriorityFee carries dao_fee_claim even with no staking rewards
  const fees = settlements.reduce(
    (s, b) =>
      s +
      (b.details?.marinade_fee_claim ?? 0) +
      (b.details?.dao_fee_claim ?? 0),
    0,
  )
  const ncap = bids.filter(
    b =>
      parseFloat(b.details.total_marinade_stakers_rewards) > 0 &&
      b.details.marinade_fee_claim + b.details.dao_fee_claim <
        ((parseFloat(b.details.total_marinade_stakers_rewards) * maxFeeBps) /
          10000) *
          0.9999,
  ).length

  let ssrFeed: SsrFeed | null = null
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`${apyUrl}/v1/epoch-pmpe/ssr`, {
        signal: AbortSignal.timeout(15000),
      })
      if (res.ok) {
        ssrFeed = (await res.json()) as SsrFeed
        break
      }
    } catch {}
    if (i < 2)
      await new Promise<void>(r => {
        setTimeout(r, 2000)
      })
  }
  if (ssrFeed === null) {
    process.stderr.write('Failed: APY SSR feed unavailable\n')
    process.exit(1)
  }

  const cur = ssrFeed.epochs.find(e => e.epoch === epoch)
  const prev = ssrFeed.epochs.find(e => e.epoch === epoch - 1)
  if (!cur || !prev) {
    process.stderr.write(
      `Failed: epoch ${epoch} or ${epoch - 1} not in APY feed\n`,
    )
    process.exit(1)
  }
  if (cur.time === prev.time) {
    process.stderr.write(
      `Failed: epoch ${epoch} and ${epoch - 1} have identical timestamps\n`,
    )
    process.exit(1)
  }
  const epochsPerYear = SECONDS_PER_YEAR / (cur.time - prev.time)

  const pmpeGross = (gross / stake) * 1000
  const pmpeAdj = ((gross - fees) / stake) * 1000
  const pmpeMax = ((gross * (1 - maxFeeBps / 10000)) / stake) * 1000
  const feesSol = fees / 1e9
  const feesFull = (gross * maxFeeBps) / 10000 / 1e9
  const apyFor = (p: number) =>
    (Math.exp(epochsPerYear * Math.log(1 + p / 1000)) - 1) * 100
  const apyGross = apyFor(pmpeGross)
  const apyAdj = apyFor(pmpeAdj)
  const apyMax = apyFor(pmpeMax)

  process.stdout
    .write(`### Fee Report — Epoch ${epoch}   (max_fee_bps: ${maxFeeBps}, min_fee_bps: ${minFeeBps})

| scenario  | fee ◎              | pmpe              | APY      | vs gross  |
|-----------|--------------------|-------------------|----------|-----------|
| gross     | 0.000              | ${pmpeGross.toFixed(6)} | ${apyGross.toFixed(2)}%  | —         |
| actual    | ${feesSol.toFixed(3)} | ${pmpeAdj.toFixed(6)} | ${apyAdj.toFixed(2)}%  | ${apyAdj - apyGross >= 0 ? '+' : ''}${(apyAdj - apyGross).toFixed(2)}pp |
| full fee  | ${feesFull.toFixed(3)} | ${pmpeMax.toFixed(6)} | ${apyMax.toFixed(2)}%  | ${apyMax - apyGross >= 0 ? '+' : ''}${(apyMax - apyGross).toFixed(2)}pp |

${ncap} of ${bids.length} Bidding validators were SSR-capped (paid less than full fee)
`)
}

main().catch(e => {
  process.stderr.write(`Failed: ${e}\n`)
  process.exit(1)
})
