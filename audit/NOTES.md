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
| 1 | Rent and minimum-delegation drift between the bonds math and stake 5.1.0 | open — live on mainnet today, direction looks conservative |
| 2 | `fund_settlement` split arithmetic | open |
| 3 | Claims are not capped by `lamports_funded`; merging funded accounts frees their reserves | **confirmed**, `t01_merge_overclaim.ts` |
| 4 | Pause blocks `cancel_settlement` and `reset_stake`; claims race the cancel after resume | open — operator-compromise item, deferred |
| 5 | Withdraw requests never expire | open — design, off-chain accounting subtracts them |
| 6 | Authority model: identity hot key, transferable bond-mint token, closed vote account strands the bond | open |
| 7 | Isolation between configs (`init_config` is permissionless) | open |
| 8 | `reset_stake` / `withdraw_stake` accept any system-owned address as a closed settlement | open |
| 9 | Merkle leaf does not commit to bond or settlement | open — merkle item, deferred |
| 10 | Anchor: duplicate-mutable check scope, compiled-in IDL instructions, optional accounts, `init` of the split account | open |

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
