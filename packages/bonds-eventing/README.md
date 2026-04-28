# Gathering bonds and DS SAM information

This module gets data from the API and works with DS SAM processing to find changes
and emit events that can later be notified by the
[Marinade Notification Service](https://github.com/marinade-finance/marinade-notifications).

## Design details

The system is stateful — it keeps a snapshot of each validator's state in `bond_event_state`
DB table and only emits events when something changes between runs.

### Design notes

- A single validator can trigger several events simultaneously (e.g., auction_exited + cap_changed + bond_balance_change in one run). They're not mutually exclusive.
- If a validator has no previous state, only first_seen fires.
- State is saved per validator. If a validator's event fails to POST, only that validator's state save is skipped (so its delta is retried on next run). Other validators whose events succeeded get their state saved normally.
- The state snapshot stored per validator is always the same shape (balance, auction status, bondGoodForNEpochs, cap constraint, SAM eligibility) regardless of which event fires. Events are derived from comparing the previous and current snapshots — the event type is orthogonal to the stored state.

#### Engineering Todo

- **Outbox cleanup**: The `notifications_outbox` table in `marinade-notifications` accumulates rows unconditionally (even for events with no subscribers). A periodic cleanup job should be implemented to delete expired rows where `relevance_until < now()` or `deactivated_at IS NOT NULL`.

## Event types

### Events emitted automatically

1. first_seen — New validator/bond detected

- When: A validator appears in the current auction data but has NO previous state in the DB
- Not emitted: On every subsequent run (once state is saved, it becomes a known validator)

2. validator_delisted — Validator disappeared from auction data

- When: A validator exists in previous state but is NOT in the current auction data, AND it had a funded bond (`funded_amount_lamports > 0`) or was in the auction (`in_auction = true`)
- Not emitted: If the validator is still present, or if the previous state had zero balance and was not in auction (phantom entries from SAM data)
- Note: After successful emission + state save, the delisted validator is deleted from bond_event_state, so this fires only once
- Details include `last_known_sam_eligible` as a hint for the probable cause of delisting

3. auction_entered — Validator joined the auction

- When: Previous state in_auction = false AND current marinadeSamTargetSol > 0
- Not emitted: If already in auction, or if newly first_seen (first_seen covers the initial state)

4. auction_exited — Validator left the auction

- When: Previous state in_auction = true AND current marinadeSamTargetSol is 0 or absent
- Not emitted: If already out of auction

5. cap_changed — Binding constraint type changed

- When: prev.cap_constraint !== currentCap (e.g., BOND → COUNTRY, or VALIDATOR → null)
- Not emitted: If the constraint type stays the same (even if the constraint name changes within the same type — only constraintType is compared)

6. bond_underfunded_change — Bond coverage (epochs) changed

- When: Either:
  - Both previous and current bondGoodForNEpochs are non-null AND they differ (e.g., 5 → 3 epochs)
  - Previous was null and current became a concrete number (transition from unknown → known)
- Not emitted: If both are the same value, or if current is null/undefined, or if previous is null and current is also null

7. bond_balance_change — SOL balance changed

- When: currentFundedLamports !== prev.funded_amount_lamports — lamport-level precision (even 1 lamport = 0.000000001 SOL triggers it)
- Not emitted: If balance is exactly the same
- Note: Uses claimableBondBalanceSol (if available) as effective amount, falls back to bondBalanceSol

8. sam_eligible_change — SAM eligibility changed

- When: prev.sam_eligible !== current samEligible
- Not emitted: If eligibility stays the same

9. settlement_applied — Pending settlement claim detected (audit-only)

- When: `bondBalanceSol - claimableBondBalanceSol > 0.01 SOL` AND changed from previous state
- Not emitted: If no settlement pending, or amount unchanged, or below 0.01 SOL dust threshold
- Note: This event is audit-only in the notification brain — it gets archived but does NOT produce a user notification. The actionable warning is provided by `penalty_expected`.

10. penalty_expected — Predicted penalty from auction simulation

- When: Total computed penalty > 0.001 SOL AND epoch changed from previous state
- Penalty types covered: BidTooLowPenalty, BlacklistPenalty, BondRiskFee
- Formula: `pmpe / 1000 * marinadeActivatedStakeSol` — matches the settlement pipeline (sam_penalties.rs)
- Not emitted: If all penalty fields are zero, or if epoch is unchanged (avoids flooding on every run)
- Note: PSR penalties (DowntimeRevenueImpact, CommissionSamIncrease) are computed by a separate pipeline and are NOT included.

### Events NOT auto-emitted

1. announcement — For admin-posted messages (e.g., "maintenance window tomorrow")

This exists in the type enum but is never produced automatically.
It's meant to be POSTed manually by admins directly to the notifications API.
See [DEV_GUIDE.md — Publishing a CLI announcement banner](../../DEV_GUIDE.md#publishing-a-cli-announcement-banner)
for the curl recipe and retraction steps.

## Troubleshooting

- **`Validator X is predicted to incur a bond risk fee Y SOL this epoch.`**<a id='troubleshooting-bond-risk-fee'></a>

  Example body emitted by the `penalty_expected` event:

  ```
  Validator 8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC is predicted to
  incur a bond risk fee 23.7997 SOL this epoch.
  ```

  **Meaning.** When this event fires, two things happen in settlement:
  1. A portion of the validator's Marinade stake gets undelegated — stake moves away from the validator this epoch.
  2. A fee (the amount shown, e.g. 23.8 SOL) is debited from the bond and given to stakers as compensation for the cost of moving that stake.

  This is not a punishment. It is _risk compensation_ — stakers had been trusting the bond to cover risk, the bond got too thin, so the protocol rebalances: move stake to a properly-bonded validator and charge the under-bonded one for the disruption. See the [Bond Risk Reduction Mechanism](https://docs.marinade.finance/marinade-protocol/protocol-overview/stake-auction-market/bond-risk-reduction-mechanism) docs for the full formula and configuration.

  The fee triggered because the bond dropped below **5 epochs of coverage** for the validator's current Marinade stake allocation.

  **Solution:**
  1. **Top up the bond.** The target is **≥ 13 epochs** of coverage — this keeps the validator both fee-safe and eligible to receive new stake from the auction. Rule of thumb: _maintain a bond that covers your own bid for 13 epochs across the current stake allocation._ Because `expectedMaxEffBidPmpe` in the auction formula can never exceed the validator's own bid, bonding for the validator's own bid is always sufficient.
  2. Monitor bond coverage on the [PSR Dashboard](https://psr.marinade.finance/) and Subscribe to [Bond Notifications](https://docs.marinade.finance/marinade-protocol/protocol-overview/stake-auction-market/bond-notifications)

  Related field in the SAM auction output: `bondGoodForNEpochs` is the same signal on a shifted scale — `0` is the fee threshold, negative means a fee is due this epoch, positive is headroom.
