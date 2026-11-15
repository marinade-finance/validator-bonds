# Validator Bonds contract audit — working notes

Working file for an audit in progress. It records what was checked, against what, and what is
still open, so the work can be resumed in a later session. The final report will be written from
it once the leads are closed.

Goal: find ways to take stake out of a validator's bond that the design does not intend, and
check that the Anchor framework and the stake program state machine behave the way the program
assumes.

## Scope and order

1. **Now:** the on-chain program (`programs/validator-bonds`), Anchor 1.2.1, stake program.
2. **Next:** the merkle side — generator, pipelines, root reuse across bonds (lead 9 below).
3. **Next:** compromised operator. Known to the team as a large trust assumption; the task is to
   bound what it can do and how incident response plays out (lead 4 below).

## What is deployed (mainnet, epoch 1087, 2026-11-15)

| Item | Value |
| --- | --- |
| Bonds program | v2.3.0, rev `d607a311`, deployed at slot 463217937, upgrade authority `6YAju4nd4t7kyuHV6NvVpMepMk11DgWyYjKVJUak2EEm` |
| Stake program | byte-identical to `core_bpf_stake-5.1.0.so` bundled in Agave (sha256 `3d2d39c5…`), deployed at slot 443232000, no upgrade authority |
| Rent for a stake account (200 bytes) | 1,666,240 lamports (Rent sysvar: 5080 per byte, threshold 1.0) |
| `Meta.rent_exempt_reserve` in stake accounts | 2,282,880 — stake 5.1.0 writes this constant and ignores it |
| Minimum delegation | 1 SOL, hard-coded in stake 5.1.0 |
| Config `vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU` | `epochs_to_claim_settlement` 3, `withdraw_lockup_epochs` 3, `minimum_stake_lamports` 1 SOL, `slots_to_start_settlement_claiming` 200,000 (about 22 hours), `min_bond_max_stake_wanted` 0, not paused |
| Config authorities | admin `BD9XxcmnvbJHgCcX8b2QMXjmcXHQ332NskFvjq6DTByU`, operator `bnop6tkYSrnXGdjfqrM89mUojG751ndzcQ7yK6JxvJX`, pause `AjGjLWx7vbzgPNxPSQUPjLNjeavQCHVS9VoJNWpnyP6n` |

Sources read:

- Bonds program at repo HEAD `56abc91`. The deployed build is rev `d607a311`; the two have not
  been diffed (shallow clone).
- Stake program: `solana-program/stake` at `05a7354` (program 5.1.0). It is no longer in the
  Agave tree.
- Anchor: fork master (1.2.2-dev). The program builds against crates.io 1.2.1 and the fork has no
  `v1.2.1` tag, so the exact 1.2.1 source has not been diffed.

The repo's bankrun tests run against bankrun 0.2.0, which carries the old native stake program,
not the 5.1.0 program that is live. The harness below closes that gap.

## Harness

`audit/harness` runs the **deployed mainnet binaries** of both programs in LiteSVM, with the
mainnet rent values. Stake and vote accounts are written directly, so any state of the stake
state machine can be set up.

```sh
cd audit/harness
npm install
python3 fetch-binaries.py        # downloads both ELFs from mainnet into ./bin
npx tsx t00_smoke.ts             # each t*.ts is a standalone script, exit code 1 on a failed check
```

## How stake leaves a bond

| Exit | Who | Gate |
| --- | --- | --- |
| `claim_withdraw_request` | bond authority or validator identity | request older than `withdraw_lockup_epochs` |
| `fund_settlement` then `claim_settlement_v2` | operator funds, anyone with a proof claims | claim delay, claim window, `max_total_claim`, bitmap |
| `close_settlement_v2` / `cancel_settlement` | anyone after expiry / operator or pause authority | pays only the split-rent refund |
| `withdraw_stake` | operator | `Initialized` account whose staker is a closed settlement's PDA |

A stake account belongs to a bond only through its withdrawer (the config's PDA) and its
`delegation.voter_pubkey`. The program delegates only to `bond.vote_account`.

## Leads

Status: **confirmed** (reproduced on the mainnet binaries), **refuted**, **open**.

| # | Lead | Status |
| --- | --- | --- |
| 1 | Rent and minimum-delegation drift between the bonds math and stake 5.1.0 | **refuted as a loss of funds** — the drift is live on mainnet and makes the program over-reserve; see below |
| 2 | `fund_settlement` split arithmetic | bookkeeping holds (`t02`); **confirmed**: two stake shapes cannot be partially funded (`t03`) |
| 3 | Claims are not capped by `lamports_funded`; merging funded accounts frees their reserves | **confirmed**, `t01_merge_overclaim.ts` |
| 4 | Pause blocks `cancel_settlement` and `reset_stake`; claims race the cancel after resume | open — operator-compromise item, deferred |
| 5 | Withdraw requests never expire | open — design, off-chain accounting subtracts them |
| 6 | Authority model: identity hot key, transferable bond-mint token, closed vote account strands the bond | cross-bond and stranger paths **refuted** (`t04`); design points still open |
| 7 | Isolation between configs (`init_config` is permissionless) | **refuted**, `t04_isolation.ts` |
| 8 | `reset_stake` / `withdraw_stake` accept any system-owned address as a closed settlement | **refuted** for third parties, `t04_isolation.ts`; re-initialising a settlement at the same address is operator-only |
| 9 | Merkle leaf does not commit to bond or settlement | open — merkle item, deferred |
| 10 | Anchor: duplicate-mutable check scope, compiled-in IDL instructions, optional accounts, `init` of the split account | mostly **refuted**, see below |

No path was found that lets a third party, another validator, or the operator of a different
config take stake out of a bond. The two confirmed items are a claim-side over-payment against
the validator (lead 3) and stake shapes that shield a bond from partial funding (lead 2).

### Lead 2 — stake shapes that `fund_settlement` cannot fund partially (confirmed)

`t02_fund_settlement_fuzz.ts` funds 400 random stake accounts (active, activating, inactive;
random delegated and free balances; random settlement need). Every funding that succeeds conserves
lamports and books `lamports_funded` correctly. Two classes of accounts fail every partial
funding. Both are counted as bond collateral off-chain, because the collector sums whole account
balances of delegated stake.

**Shape A — small delegation, large free balance.** `fund_settlement` first withdraws free
lamports into the split account, then splits what is left of the excess out of the delegation.
When that remainder is above zero and below 1 SOL, the split CPI fails with the stake program's
`InsufficientDelegation`, because a split destination needs the 1 SOL minimum delegation. This
happens for a delegation between about 1.0017 and 2.0017 SOL once the free balance exceeds the
settlement amount. Anyone can produce it by sending SOL to a bond stake account. Reproduced:
1.5 SOL delegated plus 100 SOL sent in; settlements of 1, 5, 50 and 99 SOL all fail, only one of
nearly the whole balance (99.6 SOL) funds.

**Shape B — inactive stake whose recorded delegation exceeds its balance.** The handler computes
`lamports - delegation.stake` (`fund_settlement.rs:233`) and panics on the subtraction. A validator
gets there by delegating, deactivating, withdrawing any amount after cooldown, and then assigning
both authorities to the bonds PDA directly (not through `fund_bond`, which requires activating or
active stake). The same state arises on its own after `reset_stake` of a partly claimed account
whose vote account is closed.

Impact: the validator's bond is counted in full but penalties smaller than the whole account
cannot be collected from it. This is evasion of an obligation, not a loss for validators.

Workaround available today: `merge_stake` (permissionless) the account into another bond stake
account of the same vote account in the same activation state; verified for both shapes. If the
bond has no such second account, the operator has to create and donate one, which takes an epoch.

Fix direction: in the split branch, treat a delegated remainder below the minimum delegation as
part of the funded account instead of splitting it, and use a saturating subtraction (or the
effective stake) for the non-delegated amount.

A smaller instance of the same panic: an account below `1 SOL + 2,282,880` lamports panics at
`fund_settlement.rs:200`. Under today's rent a valid minimal stake account (1 SOL + 1,666,240) is
below that line. It has nothing to fund, so only the error message is affected.

### Lead 1 — rent drift (refuted as a loss of funds)

Rent for a stake account is 1,666,240 lamports on mainnet while `Meta.rent_exempt_reserve` reads
2,282,880 in every account, old or new. The bonds program takes its reserve from the meta value,
the stake program from the Rent sysvar. Because the meta value is the larger one, every bonds
check is stricter than the stake program needs: each funded account keeps 616,640 lamports more
than required, and nothing can be withdrawn that the stake program would refuse. The split
account created by Anchor's `init` is funded from the Rent sysvar, so `split_rent_amount` is the
live 1,666,240. If rent ever rose above 2,282,880 the direction would flip and withdrawals would
start failing (liveness, not theft).

### Leads 6, 7, 8 — isolation (refuted)

`t04_isolation.ts` runs 22 attempts, all rejected by the intended guard: an attacker-owned config
funding or claiming from another config's stake; forged leaves; merging under the wrong config;
`reset_stake` on a live settlement or with an unrelated system-owned address; `withdraw_stake` on
delegated stake; a stranger or another validator opening or claiming a withdraw request on a bond
that is not theirs; a validator claiming stake delegated to a different vote account.

### Lead 10 — Anchor (mostly refuted)

- Legacy IDL instructions are **not** in the binary. Anchor 1.x compiles them only for
  `#[program(legacy_idl)]`. A legacy IDL account from older builds still exists on mainnet
  (`Du3XrzTNqhLt9gpui9LUogrLqCDrVC2HrtiNXHSJM58y`, authority = upgrade authority); the current
  program has no instruction that can update or close it, so it will stay at its old content.
- The duplicate-mutable check covers `Account`, `LazyAccount`, `InterfaceAccount` and `Migration`
  fields only. The two places that opt out with `dup` (`claim_settlement_v2`, `merge_stake`) carry
  an explicit key-inequality constraint. Stake accounts cannot alias program accounts because of
  the owner check.
- `Account<StakeAccount>` is never written back on exit (owner is not the program), and the
  handlers read balances through `get_lamports()` after CPIs, not through the stale copy.
- Not done: a diff of the fork's master against the published 1.2.1 crate.

### Lead 3 — reserves of merged settlement stake are claimable (confirmed)

`fund_settlement` credits `lamports_funded` with the stake account balance minus a reserve of
`Meta.rent_exempt_reserve + minimum_stake_lamports` (1.00228288 SOL). The reserve is meant to stay
in the account and return to the bond through `reset_stake`. `claim_settlement_v2` enforces that
reserve per source account, and caps the total by `max_total_claim` only.

`merge_stake` is permissionless and works on settlement-funded accounts. After N funded accounts
are merged, one reserve protects the whole balance, so N−1 reserves can be claimed.

It only matters when the settlement is under-funded (`lamports_funded < max_total_claim`), which
is the case whenever the bond is smaller than the claims — every funded account then contributes
"all but the reserve".

Reproduced: bond of 3 × 2 SOL, settlement of 10 SOL. Funded 2.993 SOL. Without the merge a
4.9 SOL claim fails; after two merges it succeeds, `lamports_claimed` (4.9) exceeds
`lamports_funded` (2.993), and the bond gets 1.1 SOL back instead of 3.007 SOL.

Bounded by `max_total_claim` and by each leaf, so no claimant receives more than the settlement
owes. The validator loses up to (N−1) × 1.00228288 SOL per settlement beyond what was funded.
Related known constraint in the README: a claim equal to the whole account balance also takes the
last reserve.

Open question for the team: is the reserve a promise to the validator, or only a technical
minimum? If it is a promise, cap claims by `lamports_funded`, or refuse `merge_stake` for
settlement stakers.

## Already documented by the team, not re-reported

README "Known constraints": claims into PDA-owned stake authorities; `InsufficientDelegation` on a
partial `claim_withdraw_request`; `cancel_settlement` failing in the funding epoch; unbounded
negative commission; whole-balance claim closing the funded account. Program README: the operator
has full control over deposited funds, mitigated by the claim delay.

The off-chain collector (`common-rs/src/funded_bonds.rs`) already leaves out locked stake and
stake whose staker is neither the bonds PDA nor a live settlement of that vote account.
