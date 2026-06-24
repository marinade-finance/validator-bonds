# Settlement Pipelines

Set of CLI binaries that work as a pipeline for off-chain
management of the [Validator Bonds Program](../programs/validator-bonds/README.md).

## Provided Commands

- [init-settlement](./src/bin/init_settlement.rs): Creates `Settlement` accounts on-chain from the provided JSON.
- [list-claimable-epoch](./src/bin/list_claimable_epoch.rs): Prints a list of epochs that contain `Settlement`s which can be claimed.
- [claim-settlement](./src/bin/claim_settlement.rs): Searches on-chain for settlements to be claimed and claims them based on the provided JSONs with Merkle proofs.
- [list-settlement](./src/bin/list_settlement.rs): Derives `Settlement` account addresses from the provided JSON files and prints them.
- [close-settlement](./src/bin/close_settlement.rs): Checks the chain for `Settlement`s that can be closed and resets stake accounts,
  using the provided list of `Settlement` addresses to search for the settlement stake authorities.
- [fund-settlement](./src/bin/fund_settlement.rs): Funds the `Settlement` accounts from the Bonds account based on data loaded by `init-settlement`.
- [merge-stakes](./src/bin/merge_stakes.rs): Merges stake accounts that belong to the same validator bond.
- [verify-settlement](./src/bin/verify_settlement.rs): Load all available `Settlement`'s on-chain
  and compares them to provided list of Settlement addresses (expected they were loaded from gcloud).
  It returns a list of Settlements found on-chain but not available from the gcloud listing.

## Pipeline Usage

There are 6 pipelines used for the binary commands.

- [init-settlements](../.buildkite/init-settlements.yml): Initializes settlements for an epoch based on generated JSON files.
- [fund-settlements](../.buildkite/fund-settlements.yml): Funds the `Settlement` accounts from the Bonds account based on settlement data.
- [claim-settlements](../.buildkite/claim-settlements.yml): Claims settlements when possible.
  It is executed as a cron job once at a set interval. It checks the on-chain state to see if any settlements can be claimed.
  The settlement can be claimed within the time range of `Settlement Creation + non-claimable slots` to `Settlement Creation Epoch - Config claimable epoch`.
- [close-settlements](../.buildkite/close-settlements.yml): Closes `Settlement` and `SettlementClaims` accounts,
  and resets the state of stake accounts to be associated back to the validator `Bond` when not claimed.
- [merge-stakes](../.buildkite/merge-stakes.yml): Merges stake accounts that belong to the same validator bond.
- [verify-settlements](../.buildkite/verify-settlements.yml): Loading `Settlement` merkle tree data
  from gcloud and checking if the on-chain state does not contain some unknown `Settlement` in comparison
  to gcloud list.

## Reserve Front

The reserve front makes mSOL bid-settlement APY realize on time. Without it,
validators must fund their bond stake before stakers can claim, adding a 2–6
epoch lag. The reserve eliminates that lag by pre-funding each bond settlement
from `marinade_wallet`.

### Epoch-by-epoch timeline

```
Epoch N  — settlement created
  init-settlement
    on-chain: max_total_claim = C   (real merkle sum, no inflation)
              lamports_funded  = 0

  fund-settlement  run 1   (on_chain lamports_funded == 0 → reserve fires)
    marinade_wallet → undelegated stake R+min_stake  [reserve front]
      staker = settlement_staker_authority
      immediately claimable (undelegated from the start)
    validator bond → FundSettlement C-R
      FundSettlement deactivates the bond stake so it becomes
      undelegated and withdrawable in epoch N+1
      on-chain lamports_funded = C-R

Epoch N+1  — bond stake finishes deactivating
  Both pools now undelegated, both claimable via ClaimSettlementV2:
    reserve front   R   lamports  (undelegated since epoch N)
    bond stake    C-R   lamports  (deactivated in epoch N, now undelegated)
  Total available = C = max_total_claim

  Stakers claim (may begin as early as epoch N from the reserve front):
    ClaimSettlementV2 calls StakeWithdraw on any stake with
    staker == settlement_staker_authority.
    Bound: lamports_claimed + claim ≤ max_total_claim = C.
    No check against lamports_funded — reserve lamports count toward claims
    even though they are not tracked by lamports_funded.

  fund-settlement  run 2+  (lamports_funded = C-R ≠ 0 → reserve does not re-fire)
    bond funds remaining R → lamports_funded = C = max_total_claim
    The bond's second-run R is what ultimately reimburses marinade at close.

Epoch N + epochsToClaimSettlement + 1  — claim window closed
  close-settlement
    CloseSettlementV2 closes the on-chain Settlement account.
    All remaining stakes still carry staker = settlement_staker_authority.

    Undelegated stakes → WithdrawStake → marinade_wallet:
      • reserve front remainder  (if stakers did not consume it)
      • bond stake remainder     (bond funded C total; claims consumed C;
        exactly R of bond-originated lamports remains → reaps to marinade)

    Delegated stakes (bond stakes not yet deactivated) → ResetStake → bond.

    Net: marinade recovers R via the bond's second fund run. ✓
```

### Invariants

| #   | Invariant                            | How enforced                                                |
| --- | ------------------------------------ | ----------------------------------------------------------- |
| 1   | `max_total_claim = C` — no inflation | `init-settlement` applies no reserve inflation              |
| 2   | Reserve fires at most once           | guard: `on_chain lamports_funded == 0`                      |
| 3   | Total claims bounded to C            | program: `lamports_claimed + claim ≤ max_total_claim`       |
| 4   | Bond reaches `lamports_funded = C`   | fund pipeline retries until max is reached                  |
| 5   | R reaps to marinade at close         | pipeline: undelegated → `WithdrawStake` → `marinade_wallet` |

### CLI flags

`init-settlement` and `fund-settlement` both accept:

```
--reserve-prefund-lamports <LAMPORTS>
    env: RESERVE_PREFUND_LAMPORTS   default: 0 (disabled)
```

Zero is a no-op: no reserve front, pipeline behaves exactly as before.

### Limitation

`ClaimSettlementV2` accepts any stake with `staker == settlement_staker_authority`
as the claim source, including the reserve front. In practice the Marinade-operated
claim pipeline uses bond stakes (available once deactivated in epoch N+1), leaving
the reserve front intact for the close reap. A complete fix requires a `reserve: u64`
field on the `Settlement` account so the reserve amount is unclaimable on-chain
(future program change).

## Usage

```bash
cargo run --bin <name>
```
