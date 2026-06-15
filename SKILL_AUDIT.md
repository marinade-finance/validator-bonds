# Validator Bonds Skill — Audit, Findings & Install Path

**Scope:** Audit of the `marinade-sam-bond` and `marinade-ecosystem` knowledge skills (`plugins/validator-bonds/skills/`) — are they accurate, is each fact backed by code, and do they install via the plugin marketplace?
**Date:** 2026-06-15 · **Skill branch:** `origin/20260312_skill`
**Method:** (1) ran the skill against its 19 eval cases; (2) traced every fact to source in this repo; (3) cloned upstream `ds-sam` and verified facts that don't live here; (4) ran 3 real end-user tests against live validators using the bonds + SAM scores APIs; (5) tested the marketplace install path end-to-end.

---

## 1. Headline

The skill is **accurate on facts that live in this repo's own code** (on-chain program, settlement distribution, merkle, PSR/downtime/commission, config). It is **wrong, incomplete, or out of its depth on facts whose logic lives upstream** (`ds-sam` / `ds-scoring` / `sam-blacklist` / `institutional-staking`) — it restates upstream behavior as if it were local, and the highest-stakes validator question (*"is my bond big enough / why no stake?"*) it cannot reliably answer.

**Eval tally (19 cases):** 11 confirmed in-repo · 3 verified upstream in ds-sam · 1 doc-confirmed locally · 2 unverifiable (private repos) · 4 correctness/completeness defects.

---

## 2. TO-DO LIST (skill changes)

### 🔴 Must fix

**TODO-1 — Bond sizing / stake cap (the big one).** Current text: *"Min bond balance — 7 SOL; below this, stake cap is reduced, not eligibility revoked."*
- ✅ **Keep the 7 SOL** — confirmed it is the **live production value** (`minBondBalanceSol: 7`) in the SAM scoring config. But label it *"production SAM config value,"* not a validator-bonds constant (the code default is `0`; on-chain floor is `MIN_STAKE_LAMPORTS = 1 SOL`).
- ❌ **Fix the behavior** — below **80% of min (5.6 SOL)** the stake cap is **revoked to 0**, not "reduced." (`refs/ds-sam/.../constraints.ts:275` `clipBondStakeCap`.) Proven live: validator `DeEpSdaw…` at 0.673 SOL gets **zero** stake.
- ➕ **Add the capacity formula + bond-vs-bid distinction** — see TODO-7.

**TODO-2 — BidTooLowPenalty trigger is wrong.** Current: *"Bid below minimum threshold."* Real trigger: validator **lowers its bid vs the previous epoch** (`refs/ds-sam/.../calculations.ts:248`, comment *"penalizes validators who reduce their commitment compared to the last epochs"*). The eval case had this right; the skill was wrong.

### 🟠 Should fix

**TODO-3 — Add the `PriorityFee` settlement type.** The enum has **7** top-level variants; the skill lists 6 (`settlement-distributions/settlement-common/src/settlement_collection.rs:32`). Confirmed live: validator `BLX5…` has 12 real PriorityFee charges.

**TODO-4 — "3-epoch lockup" is configurable.** It's `config.withdraw_lockup_epochs` (`programs/validator-bonds/src/state/config.rs:17`), currently ~3. Reword to *"lockup = `config.withdraw_lockup_epochs` (currently ~3)."*

**TODO-7 — The skill cannot answer "how much bond do I need for max stake."** (New, from the end-user tests.) It knows only the 7 SOL floor — it has no bond→stake **capacity formula** and no notion of the **auction clearing price**, so it cannot tell a *bond-constrained* validator apart from a *bid-constrained* one. Either:
- (a) add the capacity formula (`bondStakeCapSam`, `refs/ds-sam/.../constraints.ts:212`) and the "is your blocker the bond or the bid?" distinction, **or**
- (b) explicitly state this question needs the live SAM scores API and point operators there — rather than implying bond is always the lever.

### 🟡 Nice to have

**TODO-5 — Mark upstream-determined facts as upstream** (BidTooLowPenalty, BlacklistPenalty, BondRiskFee triggers, clearing price → ds-sam/ds-scoring/sam-blacklist; InstitutionalPayout APY → institutional-staking). The 50bps figure itself is fine (`packages/validator-bonds-cli-institutional/README.md:237`).

**TODO-6 — Blacklist reasons ("sandwich, slow slots")** are unverified (sam-blacklist is private); flag as upstream-sourced.

### ⚪ Eval-side (separate hand-off to eval owner)
- `cases/bond-risk-fee.yaml` fact `"insufficient"` is unverified (ds-scoring private); the skill's *"risk premium (scoring-calculated)"* is more defensible.
- `cases/settlement-types.yaml` should add `PriorityFee` to its `facts` (TODO-3).
- `cases/bid-too-low-penalty.yaml` facts (`reduces`, `previous epoch`) were **correct** — confirms TODO-2.

---

## 3. Code-vs-eval audit (19 cases)

✅ Confirmed in this repo · 🔻 Upstream (true, logic not here) · ⚠️ Problem

| # | Case | Verdict | Evidence |
|---|---|---|---|
| 1 | program-id | ✅ | `programs/validator-bonds/src/lib.rs:38` |
| 2 | bond-authority | ✅ | `programs/validator-bonds/src/checks.rs:109` |
| 3 | fund-bond | ✅ | `programs/validator-bonds/src/instructions/bond/fund_bond.rs:98` |
| 4 | withdrawal-steps | ⚠️ | lockup configurable (TODO-4) |
| 5 | bond-sizing | ⚠️ | 7 SOL real in prod config; "not revoked" false (TODO-1) |
| 6 | settlement-types | ⚠️ | `PriorityFee` omitted (TODO-3) — `settlement-common/src/settlement_collection.rs:32` |
| 7 | psr-definition | ✅ | `settlement-common/src/protected_events.rs:224` |
| 8 | downtime-revenue-impact | ✅ | `settlement-config.yaml:40` |
| 9 | commission-increase-penalty | ✅ | `settlement-common/src/protected_events.rs:175`, `settlement-config.yaml:55` |
| 10 | merkle-settlements | ✅ | `merkle-generator/src/merkle_generator.rs:98` + `.../claim_settlement.rs:238` |
| 11 | epoch-lifecycle | ✅ | `epochs_to_claim_settlement` gates claim/close |
| 12 | cpmpe-definition | ✅ | CLI README + `/1000` in code |
| 13 | last-price-clearing | ✅ (upstream) | `refs/ds-sam/.../auction.ts:72` |
| 14 | bidding-settlement | ✅ | `Bidding` variant, funder `ValidatorBond` |
| 15 | bid-too-low-penalty | 🔻→⚠️ | trigger in ds-sam (`calculations.ts:248`); skill mislabels (TODO-2) |
| 16 | bond-risk-fee | 🔻 | `bid-distribution/src/sam_meta.rs:66`; trigger in ds-scoring (private) |
| 17 | blacklist-penalty | 🔻 | `bid-distribution/src/generators/sam_penalties.rs:86`; reasons in sam-blacklist (private) |
| 18 | institutional-payout | ✅ / 🔻 | defined here; 50bps in `cli-institutional/README.md:237`; calc upstream |
| 19 | two-staker-populations | ✅ | separate engines + SettlementReasons |

---

## 4. Upstream verification (`refs/ds-sam`, public)

`ds-scoring`, `sam-blacklist`, `institutional-staking` are **private** — not clonable without GitHub auth.

| Fact | Verdict | Source |
|---|---|---|
| bid-too-low = "reduces bid vs previous epoch" | ✅ CONFIRMED (eval right, skill wrong) | `calculations.ts:248` |
| last-price clearing = last winning group's PMPE | ✅ CONFIRMED (uniform clearing) | `auction.ts:72` / `:103` |
| minBondBalance behavior "reduced not revoked" | ❌ REFUTED — tiered, <80% → cap `0` | `constraints.ts:275` |
| minBondBalance = **7 SOL** | ✅ CONFIRMED as **live production value** | SAM scoring config (`scoring.marinade.finance`) |
| bond → stake capacity formula | ✅ found (`bondStakeCapSam`) | `constraints.ts:212` |
| bond-risk-fee = "insufficient" | 🔒 unverifiable | ds-scoring (private) |
| blacklist "sandwich / slow slots" | 🔒 unverifiable | sam-blacklist (private) |

**Production SAM config (live, epoch 987):** `minBondBalanceSol: 7`, `minBondEpochs: 4`, `idealBondEpochs: 12`, `bondRiskFeeMult: 0.2`, `maxMarinadeTvlSharePerValidatorDec: 0.15`.

---

## 5. End-user case studies (live data)

Data: `validator-bonds-api.marinade.finance/{bonds,protected-events}` and `scoring.marinade.finance/api/v1/scores/sam`. Epoch 987.

### Case A — `BLX5PkLh7GsHaqCpLDxiW3UjxfT2GMyteVAhRZBYhCts` — *"Why did you take my stake?"*
Bond ~9.04 SOL funded (effective 0). **~215.6 SOL charged across 223 settlements:**

| Reason | Charged | Events |
|---|---|---|
| Bidding (paying the winning bid — not a penalty) | 190.24 SOL | 205 |
| ProtectedEvent: CommissionSamIncrease | 10.54 SOL | 2 |
| BidTooLowPenalty | 10.40 SOL | 2 |
| BondRiskFee | 4.10 SOL | 2 |
| PriorityFee | 0.35 SOL | 12 |

**Smoking gun — epoch 983 (13.87 SOL):** validator raised **inflation commission 4% → 100%** (98.3% reward loss to stakers) → `CommissionSamIncrease` charged 10.36 SOL from the bond, with markup penalty.

**Skill verdict:** ✅ explains CommissionSamIncrease correctly · ❌ **omits PriorityFee entirely** (12 real charges) · ⚠️ **mislabels BidTooLowPenalty** cause.

### Case B — `DeEpSdaw8uBLQ5T2HQhDf8fBSVbm13jGqJwoSF3HTpL5` — *"How much extra bond for max stake?"*
Bond **0.673 SOL**, wants **5,500 SOL**, getting **0** (`constraints: "BOND"`).
- Bond 0.673 < 5.6 (=0.8×7) → `clipBondStakeCap` returns **0** → zero stake.
- Capacity to back 5,500 SOL needs only ~3.3 SOL — so the **7 SOL floor is what binds**.
- At 7 SOL the bond supports ~11,500–16,400 SOL (well over the 5,500 request).

**Answer: add ~6.33 SOL** (0.673 → 7.0). **Bond-constrained.**
**Skill verdict:** ✅ *incidentally* right ("get to 7 SOL"), because the floor dominates here — but it has no capacity formula and misframes "revoked vs reduced."

### Case C — `EARNynHRWg6GfyJCmrrizcZxARB3HVzcaasvNa8kBS72` — *"How much extra bond for max stake?"*
Bond **399.86 SOL**, wants **500,000 SOL**, getting **0** (`constraints: ""` — *not* bond-limited).
- Bond backs ~650,000–933,000 SOL; backing 500,000 needs only ~307 SOL → **already covered**.
- Real blocker: **bid**. Auction clearing price ≈ **0.3436** totalPmpe; theirs = **0.3428** — loses by ~0.0008.

**Answer: add 0 bond — raise the bid.** **Bid-constrained.**
**Skill verdict:** ❌ cannot answer — no auction model; would say *"you're above 7 SOL, you're fine"* and miss the real cause, risking the operator wasting SOL on bond that does nothing.

### The contrast (the core lesson → TODO-7)
| Validator | Real constraint | Correct answer | Skill |
|---|---|---|---|
| `DeEpSdaw…` | **Bond** (0.673 < 7 floor) | +6.3 SOL bond | ✅ incidentally right |
| `EARNynHR…` | **Bid** (totalPmpe < clearing) | +0 bond, raise bid | ❌ would mislead |

Answering "how much bond for max stake" correctly requires telling **bond-constrained** from **bid-constrained**, which needs the SAM scores API + ds-sam logic. The skill has neither.

---

## 6. Install path — plugin marketplace (tested ✅)

The skill ships as a plugin but **lacked the manifests a marketplace requires**. Added and validated:

**`.claude-plugin/marketplace.json`** (repo root)
```json
{
  "name": "marinade",
  "description": "Marinade Finance plugins — Validator Bonds protocol knowledge skills.",
  "owner": { "name": "Marinade Finance", "url": "https://github.com/marinade-finance" },
  "plugins": [
    {
      "name": "validator-bonds",
      "source": "./plugins/validator-bonds",
      "description": "Validator Bonds protocol knowledge skills (marinade-sam-bond, marinade-ecosystem)."
    }
  ]
}
```

**`plugins/validator-bonds/.claude-plugin/plugin.json`**
```json
{
  "name": "validator-bonds",
  "version": "0.1.0",
  "description": "Marinade Validator Bonds protocol knowledge — SAM auction, settlement types, PSR, bond lifecycle, and ecosystem map.",
  "author": { "name": "Marinade Finance" }
}
```

**Verified flow:** `plugin validate` (both ✔) → `marketplace add ./` → `plugin install validator-bonds@marinade` → installed, enabled, 2 skills detected (~339 tok always-on).

**To publish:** these manifests + the skills must be committed to the branch users install from (currently the skills live only on `20260312_skill`, with no manifests). Then anyone can `claude plugin marketplace add marinade-finance/validator-bonds`.

---

## 7. Artifacts
- Skills installed (test): plugin `validator-bonds@marinade` (user scope).
- Manifests: `.claude-plugin/marketplace.json`, `plugins/validator-bonds/.claude-plugin/plugin.json`.
- Bundle: `validator-bonds-plugin.zip` (marketplace-installable).
- Upstream clone: `refs/ds-sam` (public). Other upstream repos require GitHub auth.
- Eval harness: `plugins/validator-bonds/evals/` (`bun runner.ts`).
