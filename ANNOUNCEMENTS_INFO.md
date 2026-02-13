--------------------------------
Consider this should be deleted
---

---

● Here's how the delta evaluation works. The system is stateful — it keeps a snapshot of each validator's state in bond_event_state DB table and only emits events when something changes between runs.

Events emitted automatically (7 delta types)

1. first_seen — New validator/bond detected

- When: A validator appears in the current auction data but has NO previous state in the DB
- Not emitted: On every subsequent run (once state is saved, it becomes a known validator)
- Details: balance, auction status, bondGoodForNEpochs, cap constraint, SAM eligibility

2. bond_removed — Validator disappeared

- When: A validator exists in previous state but is NOT in the current auction data
- Not emitted: If the validator is still present (even with changed values)
- Note: After successful emission + state save, the removed validator is deleted from bond_event_state, so this fires only once

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

Events NOT auto-emitted (2 types in enum only)

8. announcement — For admin-posted messages (e.g., "maintenance window tomorrow")
9. version_bump — For schema/system version changes

These exist in the type enum but are never produced by evaluateDeltas(). They're meant to be POSTed manually by admins directly to the notifications API.

Important behavior notes

- Multiple events per validator per run: A single validator can trigger several events simultaneously (e.g., auction_exited + cap_changed + bond_balance_change in one run). They're independent checks, not mutually exclusive.
- first_seen is exclusive: If a validator has no previous state, only first_seen fires — the other checks are skipped via continue.
- State is only saved on full success: If any event fails to POST, the entire state save is skipped. This means failed deltas will be re-detected and retried on the next run.
- Removal cleanup: Removed validators are deleted from state only after successful state save, preventing duplicate bond_removed events.
