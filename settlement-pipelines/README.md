# Settlement Pipelines

Set of CLI binaries that works as a pipeline off-chain
management for the [Validator Bonds Program](../programs/validator-bonds/README.md).

## Provided commands

* [init-settlement](./src/bin/init_settlement.rs) : from provided JSON it creates the `Settlement` accounts on-chain
* [list-claimable-epoch](./src/bin/list_claimable_epoch.rs) : printing a list of epochs that contains some `Settlement` that is possible to claim it
* [claim-settlement](./src/bin/claim_settlement.rs) : searching on-chain for settlements to be claimed and claiming based on provided JSONs with merkle proofs
* [list-settlement](./src/bin/list_settlement.rs) : from provided JSON files it derives `Settlement` accounts addresses and prints it out
* [close-settlement](./src/bin/close_settlement.rs) : checking chain for `Settlement`s to be possible to close and reset stake accounts, using a provided list of Settlement addresses to search for the Settlement stake authorities

## Pipeline usage

There are 3 pipelines in use for the binary commands.

* [init-settlements](../.buildkite/init-settlements.yml) : initializing Settlements for an epoch based on generated JSON files.
  The pipeline is expected to be called after the JSON files are generated at [prepare-claims](../.buildkite/prepare-claims.yml)
* [claim-settlements](../.buildkite/claim-settlements.yml) : claiming settlements when possible. It's executed as a cron job
  once a time. It checks the on-chain state if possible to claim some settlement. The Settlement can be claimed
  in the time range of < `Settlement Creation + non-claimable-slots` - `Settlement Creation Epoch - Config claimable epoch`>.
* [close-settlements](../.buildkite/close-settlements.yml) : closing `Settlement` accounts, closing `SettlementClaim` accounts,
  and resetting the state of stake accounts to be associated back to validator `Bond` when not claimed.
  It verifies the on-chain state if the Settlement expires and if it does not exist the `SettlementClaim` can be closed.


## Usage

```bash
cargo run --bin <name>
```
