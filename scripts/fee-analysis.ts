#!/usr/bin/env bun
// Usage: bun scripts/fee-analysis.ts <settlements.json>...
// Computes real vs actual fee rate, showing overcharge due to inflated staker_bid_rewards.
// Writes overcharge chart to ./tmp/fee-analysis.png

import { writeFileSync } from "node:fs";

const files = process.argv.slice(2);
if (!files.length) {
  process.stderr.write("usage: bun scripts/fee-analysis.ts <settlements.json>...\n");
  process.exit(2);
}

type Detail = {
  total_marinade_stakers_rewards: string;
  staker_bid_rewards: string | null;
  settlement_claims: { static_bid_claim: number };
  dao_fee_claim: number;
  marinade_fee_claim: number;
};

const rows: { epoch: number; actual_bps: number; real_bps: number; overcharge_sol: number }[] = [];

for (const file of files.sort()) {
  const data = await Bun.file(file).json();
  const bids: Detail[] = (data.settlements as any[])
    .filter(s => s.reason === "Bidding" && s.details != null)
    .map(s => s.details);
  if (!bids.length) continue;

  const inflated   = bids.reduce((s, d) => s + parseFloat(d.total_marinade_stakers_rewards), 0);
  const staker_bid = bids.reduce((s, d) => s + parseFloat(d.staker_bid_rewards ?? "0"), 0);
  const real_bid   = bids.reduce((s, d) => s + (d.settlement_claims?.static_bid_claim ?? 0), 0);
  const dao_fee    = bids.reduce((s, d) => s + d.dao_fee_claim + d.marinade_fee_claim, 0);
  const real       = inflated - staker_bid + real_bid;

  rows.push({
    epoch:         data.epoch,
    actual_bps:    Math.round(dao_fee / inflated * 10000 * 10) / 10,
    real_bps:      Math.round(dao_fee / real    * 10000 * 10) / 10,
    overcharge_sol: Math.round(dao_fee * (1 - real / inflated) / 1e9 * 100) / 100,
  });
}

rows.sort((a, b) => a.epoch - b.epoch);
const total = rows.reduce((s, r) => s + r.overcharge_sol, 0);

console.log("epoch  actual_bps  real_bps  overcharge_sol");
console.log("-----  ----------  --------  --------------");
for (const r of rows)
  console.log(`${r.epoch}  ${r.actual_bps.toFixed(1).padStart(10)}  ${r.real_bps.toFixed(1).padStart(8)}  ${r.overcharge_sol.toFixed(2).padStart(14)}`);
console.log("-----  ----------  --------  --------------");
console.log(`${"total".padEnd(5)}  ${"".padStart(10)}  ${"".padStart(8)}  ${total.toFixed(2).padStart(14)}`);

// SVG bar chart
const W = 1100, H = 420, pad = { top: 40, right: 20, bottom: 50, left: 60 };
const chartW = W - pad.left - pad.right;
const chartH = H - pad.top - pad.bottom;
const maxVal = Math.max(...rows.map(r => r.overcharge_sol));
const barW = Math.floor(chartW / rows.length) - 1;
const scaleY = (v: number) => chartH - (v / maxVal) * chartH;
const yTicks = 5;

const bars = rows.map((r, i) => {
  const x = pad.left + i * (chartW / rows.length);
  const y = pad.top + scaleY(r.overcharge_sol);
  const h = chartH - scaleY(r.overcharge_sol);
  return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${h.toFixed(1)}" fill="#e05c6a"/>
    <text x="${(x + barW/2).toFixed(1)}" y="${(H - pad.bottom + 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="#333">${r.epoch}</text>`;
}).join("\n  ");

const gridLines = Array.from({ length: yTicks + 1 }, (_, i) => {
  const v = (maxVal * i / yTicks);
  const y = pad.top + scaleY(v);
  return `<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${W - pad.right}" y2="${y.toFixed(1)}" stroke="#ddd"/>
    <text x="${pad.left - 5}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#555">${v.toFixed(0)}</text>`;
}).join("\n  ");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="font-family:sans-serif">
  <rect width="${W}" height="${H}" fill="white"/>
  <text x="${W/2}" y="22" text-anchor="middle" font-size="14" font-weight="bold" fill="#222">DAO fee overcharge per epoch — total ${total.toFixed(1)} SOL</text>
  <text x="${pad.left - 40}" y="${(pad.top + chartH/2).toFixed(1)}" text-anchor="middle" font-size="11" fill="#555" transform="rotate(-90,${pad.left-40},${(pad.top+chartH/2).toFixed(1)})">SOL</text>
  ${gridLines}
  ${bars}
</svg>`;

writeFileSync("./tmp/fee-analysis.svg", svg);
console.log("\nchart: ./tmp/fee-analysis.svg");
