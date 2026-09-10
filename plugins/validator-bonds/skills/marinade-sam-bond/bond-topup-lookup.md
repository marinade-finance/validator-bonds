# bond inspection and actions lookup

## On-chain instructions (all on program `vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4`)

| Instruction                    | What it does                                                       | Who calls it          |
| ------------------------------ | ------------------------------------------------------------------ | --------------------- |
| `InitBond`                     | Create a new bond account                                          | Validator / authority |
| `ConfigureBond`                | Change authority or CPMPE bid                                      | Bond authority        |
| `FundBond`                     | Add SOL to bond (top-up); rare, 0–5/day total                      | Anyone                |
| `InitWithdrawRequest`          | Start withdrawal; starts 3-epoch (`withdraw_lockup_epochs`) lockup | Bond authority        |
| `CancelWithdrawRequest`        | Cancel a pending withdrawal                                        | Bond authority        |
| `ClaimWithdrawRequest`         | Claim SOL after lockup expires                                     | Bond authority        |
| `InitSettlement`               | Create a Settlement account (operator)                             | Operator              |
| `FundSettlement`               | Fund settlement from bond stake accounts                           | Operator              |
| `ClaimSettlementV2`            | Staker claims via merkle proof; high-volume                        | Permissionless        |
| `CloseSettlementV2`            | Close expired settlement, return funds to bond                     | Permissionless        |
| `MergeStake`                   | Consolidate bond stake accounts                                    | Permissionless        |
| `ResetStake` / `WithdrawStake` | Reset or withdraw stake from bond                                  | Permissionless        |

`FundBond` clusters before epoch boundaries (validators clearing the 5.6 SOL stake-cap floor).
`ClaimSettlementV2` dominates day-to-day volume during claiming windows (~4 epochs post-settlement).

## Inspecting current bond state

**Bonds API** — `GET https://validator-bonds-api.marinade.finance/bonds/bidding`  
Fields: `vote_account`, `funded_amount`, `effective_amount`, `remaining_witdraw_request_amount`,
`remainining_settlement_claim_amount`, `cpmpe`, `epoch`.  
`updated_at` is a batch-update timestamp — not an action time. Current epoch only, no history.

**On-chain account** — Bond PDA: seeds `["bond_account", config_pubkey, vote_account_pubkey]`.
Readable via any Solana RPC `getAccountInfo`. Solscan: search by vote account, look for Bond account.

## Inspecting bond history / specific actions

**Solana RPC** — paginate `getSignaturesForAddress` on the program; filter `logMessages`
for `"Instruction: <Name>"` (e.g. `FundBond`, `InitWithdrawRequest`). Public RPC
(`api.mainnet-beta.solana.com`) rate-limits individual `getTransaction` calls; use a
private RPC (Helius, Triton) for bulk scans. Solscan program page → Transactions tab
also lets you filter by instruction name interactively.

**GCS epoch snapshots** (needs gcloud auth) — per-epoch bond state in
`gs://marinade-validator-bonds-mainnet/{epoch}/bonds.json`. Diff consecutive epochs
to detect balance changes (fund, withdrawal, settlement drain).

**Per-epoch store documents** (needs a `/bonds/**:ro` token) — `collect-bonds` writes the whole
bond set of an epoch to `/bonds/{bidding,institutional}/{epoch}` in marinade-directory. Diff two
epochs' documents the same way as the GCS snapshots:

```sh
for EPOCH in $((N-1)) $N; do
  curl -sf -H "Authorization: Bearer $DIRECTORY_TOKEN" \
    "$DIRECTORY_URL/v1/bonds/bidding/$EPOCH" > "bonds-$EPOCH.json"
done
```

**Protected events / settlements** — `GET https://validator-bonds-api.marinade.finance/protected-events`
for commission/downtime events. Settlement JSON files in
`gs://marinade-validator-bonds-mainnet/{epoch}/settlements.json` list all charges by reason and validator.
