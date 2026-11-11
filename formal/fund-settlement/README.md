# fund_settlement model

TLA+ model of bond stake accounts, one settlement and the instructions that move lamports between them (`fund_bond`, `fund_settlement`, `claim_settlement_v2`, `close_settlement_v2`, `reset_stake`, `merge_stake`, `claim_withdraw_request`), with the stake program rules they rely on (inactive split clones the recorded stake, withdraw limited by the staked amount, delegate of an inactive account rewrites the stake). Lamports are small integers, live rent is below the pinned `Meta.rent_exempt_reserve`, and warmup and cooldown take one epoch.

`Fund = "current"` models the deployed instruction, `Fund = "new"` the planned fix. `WithdrawRequests` switches `claim_withdraw_request` on.

`vote` is the bond's vote account. `CloseVoteAccount` and `ReopenVoteAccount` let the validator close it or make it a vote account again at any time. A closed account takes a kind from `VoteClosed`: `"system"` (gone or dusted), `"zeroed"` (vote-owned with the data the vote program zero-fills on close, kept alive by a top-up), or `"foreign"` (re-created under another owner). `current` rejects a non-vote owner in `fund_settlement`, rejects `"foreign"` in `reset_stake`, and fails the delegate CPI on `"zeroed"`. `new` splits under a closed vote account as under a live one, except that a split whose withdrawn surplus would need a new delegation (`leftover = 0`) funds the whole account; `reset_stake` re-delegates only to a live one. `Attributed` (L4) checks every bond account keeps a delegation; `ResetPossible` (L5) checks a closed vote account never blocks the reset. `Transfers` lists the lamports anyone may send to a bond account; the three full cfgs keep it empty because any value makes their state space too large to finish, and `new-funding.cfg` shrinks the model to two accounts to afford them.

```
java -cp tla2tools.jar tlc2.TLC -workers auto -config current.cfg FundSettlement.tla
java -cp tla2tools.jar tlc2.TLC -workers auto -config new.cfg FundSettlement.tla
java -cp tla2tools.jar tlc2.TLC -workers auto -config new-withdraw-requests.cfg FundSettlement.tla
java -cp tla2tools.jar tlc2.TLC -workers auto -config new-funding.cfg FundSettlement.tla
java -cp tla2tools.jar tlc2.TLC -workers auto -config current-funding.cfg FundSettlement.tla
```

Expected results, each mirrored by a case of `packages/validator-bonds-sdk/__tests__/litesvm/fundSettlementMatrix.spec.ts`:

- `current.cfg` violates `NoPanic`: a bond account between the live-rent minimum and the minimal size panics in `main`'s `fund_settlement` at the whole-account subtraction `lamports - stake_account_min_size`. With size 3 removed it panics at the split's `lamports - delegation.stake` on an account handed over underwater, and without `NoPanic` it violates `NoProgramMadeUnderwater` through the leftover cloned from an inactive source.
- `new.cfg` finds no error (about 413M distinct states, 34 minutes).
- `new-withdraw-requests.cfg` violates `NoProgramMadeUnderwater`, and the trace ends with `ClaimWithdrawRequest`: it splits an inactive bond account and the leftover kept by the bond inherits the full recorded stake. With the fix that leftover is still fully fundable, so `NoProgramMadeUnderwater` is stricter than what funding needs. A trace ending in any other action is a real defect. Without `NoProgramMadeUnderwater` and with `VoteClosed = {"system"}` the run does not finish on a workstation; every behaviour up to 40 steps (about 4.9G distinct states) holds every other invariant.
- `new-funding.cfg` finds no error with `FundingPossible` (about 1.7M distinct states, seconds). Without the small-split rule it fails: transfers onto an active account whose stake is below twice the minimum delegation make the program withdraw the surplus and then split off less than the minimum delegation, which the stake program rejects. `Fund = "new"` keeps such a leftover in the funded account and delegates the withdrawn surplus, or funds the whole account when that surplus is below the minimum delegation. `OverfundBounded` allows that up to `2 * MinStake + SplitRent`, which assumes `MinStake >= Pinned`; with the old `MinSize + SplitRent` bound the cfg reports the fallback. `stl.funded` counts the lamports the settlement actually holds.
- `current-funding.cfg` violates `FundingPossible`: after the validator closes its vote account, the owner constraint rejects every `fund_settlement` of its bond. `Transfers` is empty, so the closed vote account is the only cause.

Accepted by design, so not a defect when a review or a run finds it:

- A whole account funded only because the vote account is closed while nothing stays delegated to split off (`leftover = 0`) overfunds without bound. The ghost `stl.wholeForced` exempts it from `OverfundBounded`; the excess returns to the bond through `reset_stake` after close.
- A small-split leftover kept in the funded account overfunds by less than `2 * MinStake + SplitRent`, and `stl.funded` counts the lamports the settlement holds, not the instruction's `lamports_funded`.
- An account that `reset_stake` returned without re-delegating keeps a recorded stake that still includes the paid claims. The ghost `resetSkipped` exempts exactly these accounts from `NoProgramMadeUnderwater`.
- `FundBond`, `HandoverUnderwater` and `DeactivateDelinquent` need a live vote account, because each makes the stake program read it. A stake already delegated survives the close: its voter stays the bond's vote address.
- The vote account closes and reopens at any time, ignoring the vote program's two-epoch credit window. This over-approximates what a validator can do.
- Cooldown takes one epoch, so an account still cooling down while holding fewer lamports than its recorded stake is unreachable, and `FundingPossible` does not cover it. The stake program rejects its split with `InsufficientFunds` (matrix case "cooling, withdrawn below its recorded stake").
- The model has one settlement, so it cannot show that an inactive account funded whole under a closed vote account leaves the bond's sibling settlements of that epoch unfunded until close (matrix test "sibling settlement: under a closed vote account an inactive source is funded whole").
