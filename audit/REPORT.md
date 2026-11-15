# Validator Bonds contract audit — interim report

Status: **on-chain phase, in progress.** Two phases are still to come (merkle side, compromised
operator). This file is also the hand-over for the next session: the last section says where to
resume.

## Summary

The question was whether anyone can take stake out of a validator's bond in a way the design does
not intend, and whether Anchor and the stake program behave the way the program assumes.

**No way was found for a third party, another validator, or the operator of a different config to
take stake from a bond.** 22 direct attempts and three randomized runs (about 600 fundings,
withdrawals and settlements) were executed against the binaries deployed on mainnet and none
broke an ownership or accounting rule.

Two issues were confirmed. Neither lets an outsider steal, but both move money in a way the
design does not describe:

| # | Finding | Who is affected | Severity (proposed) |
| --- | --- | --- | --- |
| F1 | Bond stake in two shapes cannot be partially funded into a settlement | Stakers and Marinade: the bond counts as collateral but penalties cannot be collected from it | Medium |
| F2 | Merging settlement-funded stake lets claims pay out the per-account reserves | The validator: loses up to (N−1) × 1.0023 SOL per under-funded settlement | Low |

Three design points were reproduced and need a decision rather than a fix (D1–D3), and three
observations are informational (I1–I3).

## What was tested, and against what

| Item | Value |
| --- | --- |
| Bonds program on mainnet | v2.3.0, rev `d607a311`, deployed at slot 463217937, upgrade authority `6YAju4nd4t7kyuHV6NvVpMepMk11DgWyYjKVJUak2EEm` |
| Stake program on mainnet | byte-identical to `core_bpf_stake-5.1.0.so` bundled in Agave; deployed at slot 443232000; no upgrade authority. **Stake 5.1.0 is already live.** |
| Rent for a stake account | 1,666,240 lamports (Rent sysvar: 5080 per byte) — already lowered from 2,282,880 |
| `Meta.rent_exempt_reserve` | 2,282,880 in every stake account; stake 5.1.0 writes this constant and no longer uses it |
| Minimum delegation | 1 SOL, hard-coded in stake 5.1.0 |
| Config `vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU` | `epochs_to_claim_settlement` 3, `withdraw_lockup_epochs` 3, `minimum_stake_lamports` 1 SOL, `slots_to_start_settlement_claiming` 200,000 (about 22 hours), `min_bond_max_stake_wanted` 0, not paused |
| Config authorities | admin `BD9XxcmnvbJHgCcX8b2QMXjmcXHQ332NskFvjq6DTByU`, operator `bnop6tkYSrnXGdjfqrM89mUojG751ndzcQ7yK6JxvJX`, pause `AjGjLWx7vbzgPNxPSQUPjLNjeavQCHVS9VoJNWpnyP6n` |

Values read from mainnet RPC at epoch 1087 (2026-11-15).

Sources read:

- Bonds program at repo HEAD `56abc91`, all 23 instructions. Rev `d607a311` is not in the fetched
  history, so there is no source diff against the deployed build; the panic locations the deployed
  binary reports (`fund_settlement.rs:200` and `:233`) match the HEAD source lines.
- Stake program: `solana-program/stake` at `05a7354` (program 5.1.0). The stake program is no
  longer in the Agave tree; Agave only bundles the binary.
- Anchor: the fork's master (1.2.2-dev) and the published 1.2.1 crates the program builds
  against. The fork is ahead (mostly hygiene of generated identifiers); the behaviours this
  program relies on were checked in the 1.2.1 source.

### Harness

The repo's bankrun tests run on bankrun 0.2.0, which carries the old native stake program, not
the 5.1.0 program that is live (I3). `audit/harness` therefore runs the **deployed mainnet
binaries** of both programs in LiteSVM with the mainnet rent. Stake and vote accounts are written
directly, so any state can be set up.

```sh
cd audit/harness
npm install
npm run fetch      # downloads both ELFs from mainnet into ./bin
npm test           # runs every t0*.ts; each is standalone and exits 1 on a failed check
```

| Script | What it shows |
| --- | --- |
| `t00_smoke.ts` | fund → settle → claim works on the mainnet binaries |
| `t01_merge_overclaim.ts` | F2 |
| `t02_fund_settlement_fuzz.ts` | 400 random stake accounts through `fund_settlement` |
| `t03_unfundable_shapes.ts` | F1, both shapes, and the merge workaround |
| `t04_isolation.ts` | 22 rejected attempts across configs, bonds and authorities |
| `t05_lifecycle.ts` | close and reset after expiry; D1, D2, D3 |
| `t06_withdraw_request_fuzz.ts` | 150 bonds through `claim_withdraw_request` |
| `t07_claim_fuzz.ts` | 60 random settlements with merges and donations, through close and reset |

Limit of the harness: the stake history is empty, so stake activates and deactivates fully at the
next epoch boundary. Partially warmed or cooled stake (network-wide rate limit) is not exercised.

## How stake leaves a bond

| Exit | Who | Gate |
| --- | --- | --- |
| `claim_withdraw_request` | bond authority or validator identity | request older than `withdraw_lockup_epochs` |
| `fund_settlement` then `claim_settlement_v2` | operator funds, anyone with a proof claims | claim delay, claim window, `max_total_claim`, claims bitmap |
| `close_settlement_v2` / `cancel_settlement` | anyone after expiry / operator or pause authority | pays only the split-rent refund |
| `withdraw_stake` | operator | `Initialized` account whose staker is a closed settlement's PDA |

A stake account belongs to a bond only through its withdrawer (the config's PDA) and its
`delegation.voter_pubkey`. The program delegates only to `bond.vote_account`, so stake cannot be
moved between bonds.

## Findings

### F1 — Bond stake that cannot be partially funded (Medium)

Two kinds of stake account are counted as bond collateral off-chain (the collector sums whole
account balances of delegated, unlocked stake under the bonds PDA) but make every partial
`fund_settlement` fail. `t03_unfundable_shapes.ts` reproduces both.

**Shape A — small delegation, large free balance.** `fund_settlement` first withdraws free
lamports into the split account, then splits the rest of the excess out of the delegation. When
that rest is above zero and below 1 SOL, the split CPI fails with the stake program's
`InsufficientDelegation`: a split destination must hold the 1 SOL minimum delegation. It happens
for a delegation between about 1.0017 and 2.0017 SOL as soon as the free balance exceeds the
amount the settlement needs. Sending SOL to a bond stake account is enough to create it.

Reproduced: 1.5 SOL delegated plus 100 SOL sent in. Settlements of 1, 5, 50 and 99 SOL all fail;
only one of nearly the whole balance (99.6 SOL) funds, through the no-split branch.

**Shape B — inactive stake whose recorded delegation exceeds its balance.** The handler computes
`lamports - delegation.stake` (`fund_settlement.rs:233`) and panics. A validator gets there by
delegating, deactivating, withdrawing any amount after cooldown, and assigning both authorities
to the bonds PDA directly (`fund_bond` would refuse inactive stake, a plain `Authorize` does
not). The same state also arises without intent, after `reset_stake` of a partly claimed account
whose vote account was closed.

**Impact.** The bond is counted in full, but a penalty smaller than the whole account cannot be
collected from it. This is evasion of an obligation, not a loss for validators.

**Workaround today.** `merge_stake` is permissionless: merging the account into another bond
stake account of the same vote account, in the same activation state, makes it fundable again
(verified for both shapes). If the bond has no such second account the operator must create and
donate one, which takes an epoch out of the three-epoch claim window. Whether the
`merge-stakes` pipeline step already covers this belongs to the off-chain phase.

**Fix direction.** In the split branch, keep a delegated remainder below the minimum delegation
inside the funded account instead of splitting it, and compute the non-delegated amount with a
saturating subtraction (or from the effective stake).

### F2 — Reserves of merged settlement stake are claimable (Low)

`fund_settlement` credits `lamports_funded` with the stake balance minus a reserve of
`Meta.rent_exempt_reserve + minimum_stake_lamports` (1.00228288 SOL). The reserve is meant to
stay in the account and return to the bond through `reset_stake`. `claim_settlement_v2` enforces
the reserve per source account and caps the total by `max_total_claim` only — not by
`lamports_funded`.

`merge_stake` is permissionless and accepts settlement-funded accounts. Once N funded accounts
are merged, one reserve protects the whole balance and the other N−1 can be claimed.

It matters only when the settlement is under-funded, which is the normal case when a bond is
smaller than the claims against it.

Reproduced (`t01_merge_overclaim.ts`): bond of 3 × 2 SOL, settlement of 10 SOL, 2.993 SOL funded.
Without the merge a 4.9 SOL claim fails. After two merges it succeeds, `lamports_claimed` (4.9)
exceeds `lamports_funded` (2.993), and the bond gets 1.1 SOL back instead of 3.007 SOL.

**Bound.** No claimant receives more than their leaf, and the total stays within
`max_total_claim`. The README already lists the related case where a claim equal to the whole
account balance takes the last reserve.

**Question for the team.** Is the reserve a promise to the validator or only a technical
minimum? If a promise: cap claims by `lamports_funded`, or refuse `merge_stake` when the staker is
a settlement PDA.

## Design points that need a decision

### D1 — Pause also blocks the recovery instructions

`cancel_settlement` and `reset_stake` are rejected while the program is paused, and claims become
valid again the moment it is resumed. `t05_lifecycle.ts` confirms both, and confirms that
`emergency_resume` and `cancel_settlement` fit into one transaction, which closes the window for
that settlement. With many settlements to cancel, several transactions are needed and claims can
land between them. This belongs to the compromised-operator phase; the documented response
(rotate the operator within the 200,000-slot claim delay, then cancel) does not use pause at all.

### D2 — Withdraw requests never expire

A request opened once stays claimable forever and covers stake funded later. Reproduced: a
request for `u64::MAX` opened 50 epochs earlier released 500 SOL in the epoch that stake arrived.
Nothing on-chain stops a validator from pulling stake between a settlement's creation and its
funding. The off-chain collector subtracts open requests from the effective bond, so the control
is entirely off-chain.

### D3 — A closed vote account strands the bond

`init_withdraw_request`, `claim_withdraw_request` and `cancel_withdraw_request` require the vote
account to be owned by the vote program. Once a validator closes its vote account the bond stake
cannot be withdrawn by anyone, including the bond authority (`reset_stake` tolerates a closed
vote account, the withdraw instructions do not). Recreating a vote account at the same address
needs the vote account keypair.

## Informational

- **I1 — Rent drift is live and harmless.** The bonds math reads 2,282,880 from the stake meta
  while the stake program enforces 1,666,240 from the sysvar. Every bonds check is therefore
  stricter than needed; each funded account keeps 616,640 lamports more than required. A stake
  account below `1 SOL + 2,282,880` lamports panics in `fund_settlement` (`:200`) instead of
  returning an error; under today's rent a valid minimal stake account is below that line. If
  rent ever rose above 2,282,880, withdrawals would start failing.
- **I2 — Stale legacy IDL account.** Anchor 1.x compiles the legacy IDL instructions only for
  `#[program(legacy_idl)]`, so they are not in the binary. The legacy IDL account from older
  builds still exists (`Du3XrzTNqhLt9gpui9LUogrLqCDrVC2HrtiNXHSJM58y`, authority = upgrade
  authority) and can no longer be updated or closed by the program.
- **I3 — The repo's tests do not run the live stake program.** bankrun 0.2.0 ships the old
  native stake program. F1 shape A depends on 5.1.0 behaviour (hard 1 SOL minimum delegation).

## Checked and found sound

- **Config isolation.** `init_config` is permissionless, but every instruction ties bond,
  settlement and withdrawer PDA to one config. An attacker-owned config could not fund, claim,
  merge or withdraw another config's stake.
- **Closed-settlement check.** `reset_stake` and `withdraw_stake` accept any system-owned address
  as a closed settlement, but the stake's staker must be the PDA derived from that address, which
  only `fund_settlement` sets. Re-initialising a settlement at an old address is operator-only.
- **Authority.** A stranger or another validator cannot open, cancel or claim a withdraw request
  on a bond that is not theirs, and cannot claim stake delegated to another vote account.
- **Merkle proof.** Leaf and intermediate hashes are domain-separated, the leaf is fixed-length,
  the index is bounded by the bitmap. A forged leaf is rejected by the proof check.
- **`fund_settlement` bookkeeping.** Whenever a funding succeeds, lamports are conserved and
  `lamports_funded` is exact (400 random accounts).
- **`claim_withdraw_request`.** Never pays more than requested; remainders stay under the PDA
  (150 bonds).
- **Settlement lifecycle.** Each leaf is paid once and exactly; after close and reset the bond
  holds its previous balance minus what claimants received (60 random settlements with merges and
  donations).
- **Stake program.** Nothing a third party can do to a PDA-owned stake account moves value out:
  sending lamports in (F1 shape A), `DeactivateDelinquent` on a delinquent validator, and reward
  payouts were considered. Lockups cannot be re-armed by a custodian once expired.
- **Anchor 1.2.1.** The duplicate-mutable check covers `Account` types; the two `dup` opt-outs
  carry an explicit key-inequality constraint. Foreign-owned accounts (`StakeAccount`, `Mint`,
  `TokenAccount`) are never written back on exit. No field or argument name of this program
  collides with the unhygienic identifiers that 1.2.1's generated code still uses.

Already documented by the team and not re-reported: the README's "Known constraints", and the
operator's full control over deposited funds.

## Not covered yet

- `mint_bond`, `configure_bond_with_mint` and the bond-product instructions were read but not
  executed in the harness (they need the token and metadata programs loaded).
- Partially activated or cooled stake (non-empty stake history), e.g. `reset_stake` hitting
  `TooSoonToRedelegate`.
- Source diff between repo HEAD and the deployed revision `d607a311`.

## Next phases

1. **Merkle side.** Generator, pipelines, and whether a merkle root can be shared across bonds:
   a leaf commits to staker, withdrawer, amount and index, but not to the bond or settlement.
   Also for this phase: does the `merge-stakes` pipeline step cover F1, and how the collector
   treats inactive stake.
2. **Compromised operator.** The operator can create and fund arbitrary settlements; bound what it
   can reach within the 200,000-slot delay and walk through incident response, including D1.

## Resume here

Everything above is reproducible with `npm test` in `audit/harness`. Open items, in order:
load the token and metadata programs into the harness and run the mint paths; add stake-history
entries to exercise partial cooldown; then start the merkle phase.
