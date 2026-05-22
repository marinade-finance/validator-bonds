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
    .filter(s => s.reason === "Bidding")
    .map(s => s.details);
  if (!bids.length) continue;

  const inflated   = bids.reduce((s, d) => s + parseFloat(d.total_marinade_stakers_rewards), 0);
  const staker_bid = bids.reduce((s, d) => s + parseFloat(d.staker_bid_rewards ?? "0"), 0);
  const real_bid   = bids.reduce((s, d) => s + (d.settlement_claims.static_bid_claim ?? 0), 0);
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

// PNG via quickchart.io
const chart = {
  type: "bar",
  data: {
    labels: rows.map(r => String(r.epoch)),
    datasets: [{
      label: "Overcharge to DAO (SOL)",
      data: rows.map(r => r.overcharge_sol),
      backgroundColor: "rgba(255, 99, 132, 0.7)",
    }],
  },
  options: {
    plugins: {
      title: { display: true, text: `DAO fee overcharge per epoch (total: ${total.toFixed(1)} SOL)` },
    },
    scales: { y: { title: { display: true, text: "SOL" } } },
  },
};

const res = await fetch("https://quickchart.io/chart", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ chart, width: 900, height: 400, backgroundColor: "white" }),
});

if (res.ok) {
  writeFileSync("./tmp/fee-analysis.png", Buffer.from(await res.arrayBuffer()));
  console.log("\nchart: ./tmp/fee-analysis.png");
} else {
  process.stderr.write(`chart render failed: ${res.status}\n`);
}
