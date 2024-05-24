# Settlement Pipelines

Set of CLI binaries that work as a pipeline for off-chain
management of the [Validator Bonds Program](../programs/validator-bonds/README.md).

## Provided Commands

* [init-settlement](./src/bin/init_settlement.rs): Creates `Settlement` accounts on-chain from the provided JSON.
* [list-claimable-epoch](./src/bin/list_claimable_epoch.rs): Prints a list of epochs that contain `Settlement`s which can be claimed.
* [claim-settlement](./src/bin/claim_settlement.rs): Searches on-chain for settlements to be claimed and claims them based on the provided JSONs with Merkle proofs.
* [list-settlement](./src/bin/list_settlement.rs): Derives `Settlement` account addresses from the provided JSON files and prints them.
* [close-settlement](./src/bin/close_settlement.rs): Checks the chain for `Settlement`s that can be closed and resets stake accounts,
  using the provided list of `Settlement` addresses to search for the settlement stake authorities.

## Pipeline Usage

There are 3 pipelines used for the binary commands.

* [init-settlements](../.buildkite/init-settlements.yml): Initializes settlements for an epoch based on generated JSON files.
  This pipeline is expected to be called after the JSON files are generated at [prepare-claims](../.buildkite/prepare-claims.yml).
* [claim-settlements](../.buildkite/claim-settlements.yml): Claims settlements when possible.
  It is executed as a cron job once at a set interval. It checks the on-chain state to see if any settlements can be claimed.
  The settlement can be claimed within the time range of `Settlement Creation + non-claimable slots` to `Settlement Creation Epoch - Config claimable epoch`.
* [close-settlements](../.buildkite/close-settlements.yml): Closes `Settlement` accounts, `SettlementClaim` accounts,
  and resets the state of stake accounts to be associated back to the validator `Bond` when not claimed.
  It verifies the on-chain state to see if the settlement has expired and if any `SettlementClaim` can be closed.


## Usage

```bash
cargo run --bin <name>
```
