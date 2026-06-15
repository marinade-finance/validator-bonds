# BUGS

Bugs found during review. Fix only when explicitly asked.

---

## [OPEN] --target-pmpe flag missing from clap Args struct

**File:** `settlement-distributions/bid-distribution/src/bin/cli.rs:36`
**Found:** codex review, 2026-06-15, branch 20260604_analytics
The `--target-pmpe` CLI override is wired into bisection logic but no `target_pmpe` field exists in the `Args` struct. Clap will reject the flag at runtime.

---

## [OPEN] target_pmpe None when both min_yield_premium and min_sol_revenue absent

**File:** `settlement-distributions/bid-distribution/src/bin/cli.rs:306`, `generators/bidding.rs:201`
**Found:** codex review, 2026-06-15, branch 20260604_analytics
If neither `min_yield_premium_over_ssr_pmpe` nor `min_sol_revenue` is set, `target_pmpe` resolves to `None`, which bidding.rs coerces to `0`. This disables the SSR floor and drives fees to max. Should either require one target mode or default to zero-over-SSR explicitly.

---

## [OPEN] PriorityFee SOL-mode feasibility: activating_bid_claim counted but activating stake not

**File:** `settlement-distributions/bid-distribution/src/generators/bidding.rs:128`, `bidding.rs:225`
**Found:** codex review, 2026-06-15, branch 20260604_analytics
PriorityFee fallback totals include `activating_bid_claim` as rewards but `total_marinade_active_stake` as stake. For activating-only validators stake is 0, so SOL-mode bisection marks the probe infeasible even when PriorityFee revenue exists.

---

## [OPEN] PMPE inflation: activating_bid_claim in rewards but activating stake excluded from denominator

**File:** `settlement-distributions/bid-distribution/src/generators/bidding.rs:461`, `bidding.rs:122`
**Found:** codex review, 2026-06-15, branch 20260604_analytics
`total_marinade_stakers_rewards` includes `activating_bid_claim` while PMPE divides by active + redelegation stake only. For mixed active/activating validators this inflates PMPE headroom and can permit excessive fees.

---

## [OPEN] Rewards mismatch demoted to warning — bad inputs proceed into settlement

**File:** `settlement-distributions/bid-distribution/src/rewards.rs:495`
**Found:** codex review, 2026-06-15, branch 20260604_analytics
Rewards invariant check changed from hard error to warn-below-threshold. Bad reward inputs now proceed into settlement generation. Jito redistribution uses `saturating_sub` earlier, so impossible totals can be silently accepted.

---

## [OPEN] simulate-fee.ts + fee-annotation.ts: PMPE accounting mismatch

**File:** `scripts/simulate-fee.ts:355`, `scripts/fee-annotation.ts:132`
**Found:** codex review, 2026-06-15, branch 20260604_analytics
`totalRewards` includes activating bid rewards (via Bidding details) and `feeAdj` includes PriorityFee fees, but `stake` excludes activating stake — same asymmetry as bidding.rs:461 but in the reporting layer.
