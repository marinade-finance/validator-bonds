# Validator Bonds

<!-- shields validator-bonds program version is loaded from resources/idl/.json -->
<a href="https://explorer.solana.com/address/vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmarinade-finance%2Fvalidator-bonds%2Fmain%2Fresources%2Fidl%2Fvalidator_bonds.json&query=%24.version&label=program&logo=data:image/svg%2bxml;base64,PHN2ZyB3aWR0aD0iMzEzIiBoZWlnaHQ9IjI4MSIgdmlld0JveD0iMCAwIDMxMyAyODEiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxnIGNsaXAtcGF0aD0idXJsKCNjbGlwMF80NzZfMjQzMCkiPgo8cGF0aCBkPSJNMzExLjMxOCAyMjEuMDU3TDI1OS42NiAyNzYuNTU4QzI1OC41MzcgMjc3Ljc2NCAyNTcuMTc4IDI3OC43MjUgMjU1LjY2OSAyNzkuMzgyQzI1NC4xNTkgMjgwLjAzOSAyNTIuNTMgMjgwLjM3OCAyNTAuODg0IDI4MC4zNzdINS45OTcxOUM0LjgyODcgMjgwLjM3NyAzLjY4NTY4IDI4MC4wMzUgMi43MDg1NSAyNzkuMzkzQzEuNzMxNDMgMjc4Ljc1MSAwLjk2Mjc3MSAyNzcuODM3IDAuNDk3MDIgMjc2Ljc2NEMwLjAzMTI2OTEgMjc1LjY5IC0wLjExMTI4NiAyNzQuNTA0IDAuMDg2ODcxMiAyNzMuMzVDMC4yODUwMjggMjcyLjE5NiAwLjgxNTI2NSAyNzEuMTI2IDEuNjEyNDMgMjcwLjI3TDUzLjMwOTkgMjE0Ljc2OUM1NC40Mjk5IDIxMy41NjYgNTUuNzg0MyAyMTIuNjA3IDU3LjI4OTMgMjExLjk1QzU4Ljc5NDMgMjExLjI5MyA2MC40MTc4IDIxMC45NTMgNjIuMDU5NSAyMTAuOTVIMzA2LjkzM0MzMDguMTAxIDIxMC45NSAzMDkuMjQ0IDIxMS4yOTIgMzEwLjIyMSAyMTEuOTM0QzMxMS4xOTkgMjEyLjU3NiAzMTEuOTY3IDIxMy40OSAzMTIuNDMzIDIxNC41NjRDMzEyLjg5OSAyMTUuNjM3IDMxMy4wNDEgMjE2LjgyNCAzMTIuODQzIDIxNy45NzdDMzEyLjY0NSAyMTkuMTMxIDMxMi4xMTUgMjIwLjIwMSAzMTEuMzE4IDIyMS4wNTdaTTI1OS42NiAxMDkuMjk0QzI1OC41MzcgMTA4LjA4OCAyNTcuMTc4IDEwNy4xMjcgMjU1LjY2OSAxMDYuNDdDMjU0LjE1OSAxMDUuODEzIDI1Mi41MyAxMDUuNDc0IDI1MC44ODQgMTA1LjQ3NUg1Ljk5NzE5QzQuODI4NyAxMDUuNDc1IDMuNjg1NjggMTA1LjgxNyAyLjcwODU1IDEwNi40NTlDMS43MzE0MyAxMDcuMTAxIDAuOTYyNzcxIDEwOC4wMTUgMC40OTcwMiAxMDkuMDg4QzAuMDMxMjY5MSAxMTAuMTYyIC0wLjExMTI4NiAxMTEuMzQ4IDAuMDg2ODcxMiAxMTIuNTAyQzAuMjg1MDI4IDExMy42NTYgMC44MTUyNjUgMTE0LjcyNiAxLjYxMjQzIDExNS41ODJMNTMuMzA5OSAxNzEuMDgzQzU0LjQyOTkgMTcyLjI4NiA1NS43ODQzIDE3My4yNDUgNTcuMjg5MyAxNzMuOTAyQzU4Ljc5NDMgMTc0LjU1OSA2MC40MTc4IDE3NC44OTkgNjIuMDU5NSAxNzQuOTAySDMwNi45MzNDMzA4LjEwMSAxNzQuOTAyIDMwOS4yNDQgMTc0LjU2IDMxMC4yMjEgMTczLjkxOEMzMTEuMTk5IDE3My4yNzYgMzExLjk2NyAxNzIuMzYyIDMxMi40MzMgMTcxLjI4OEMzMTIuODk5IDE3MC4yMTUgMzEzLjA0MSAxNjkuMDI4IDMxMi44NDMgMTY3Ljg3NUMzMTIuNjQ1IDE2Ni43MjEgMzEyLjExNSAxNjUuNjUxIDMxMS4zMTggMTY0Ljc5NUwyNTkuNjYgMTA5LjI5NFpNNS45OTcxOSA2OS40MjY3SDI1MC44ODRDMjUyLjUzIDY5LjQyNzUgMjU0LjE1OSA2OS4wODkgMjU1LjY2OSA2OC40MzJDMjU3LjE3OCA2Ny43NzUxIDI1OC41MzcgNjYuODEzOSAyNTkuNjYgNjUuNjA4MkwzMTEuMzE4IDEwLjEwNjlDMzEyLjExNSA5LjI1MTA3IDMxMi42NDUgOC4xODA1NiAzMTIuODQzIDcuMDI2OTVDMzEzLjA0MSA1Ljg3MzM0IDMxMi44OTkgNC42ODY4NiAzMTIuNDMzIDMuNjEzM0MzMTEuOTY3IDIuNTM5NzQgMzExLjE5OSAxLjYyNTg2IDMxMC4yMjEgMC45ODM5NDFDMzA5LjI0NCAwLjM0MjAyNiAzMDguMTAxIDMuOTUzMTRlLTA1IDMwNi45MzMgMEw2Mi4wNTk1IDBDNjAuNDE3OCAwLjAwMjc5ODY2IDU4Ljc5NDMgMC4zNDMxNCA1Ny4yODkzIDAuOTk5OTUzQzU1Ljc4NDMgMS42NTY3NyA1NC40Mjk5IDIuNjE2MDcgNTMuMzA5OSAzLjgxODQ3TDEuNjI1NzYgNTkuMzE5N0MwLjgyOTM2MSA2MC4xNzQ4IDAuMjk5MzU5IDYxLjI0NCAwLjEwMDc1MiA2Mi4zOTY0Qy0wLjA5Nzg1MzkgNjMuNTQ4OCAwLjA0MzU2OTggNjQuNzM0MiAwLjUwNzY3OSA2NS44MDczQzAuOTcxNzg5IDY2Ljg4MDMgMS43Mzg0MSA2Ny43OTQzIDIuNzEzNTIgNjguNDM3MkMzLjY4ODYzIDY5LjA4MDIgNC44Mjk4NCA2OS40MjQgNS45OTcxOSA2OS40MjY3WiIgZmlsbD0idXJsKCNwYWludDBfbGluZWFyXzQ3Nl8yNDMwKSIvPgo8L2c+CjxkZWZzPgo8bGluZWFyR3JhZGllbnQgaWQ9InBhaW50MF9saW5lYXJfNDc2XzI0MzAiIHgxPSIyNi40MTUiIHkxPSIyODcuMDU5IiB4Mj0iMjgzLjczNSIgeTI9Ii0yLjQ5NTc0IiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+CjxzdG9wIG9mZnNldD0iMC4wOCIgc3RvcC1jb2xvcj0iIzk5NDVGRiIvPgo8c3RvcCBvZmZzZXQ9IjAuMyIgc3RvcC1jb2xvcj0iIzg3NTJGMyIvPgo8c3RvcCBvZmZzZXQ9IjAuNSIgc3RvcC1jb2xvcj0iIzU0OTdENSIvPgo8c3RvcCBvZmZzZXQ9IjAuNiIgc3RvcC1jb2xvcj0iIzQzQjRDQSIvPgo8c3RvcCBvZmZzZXQ9IjAuNzIiIHN0b3AtY29sb3I9IiMyOEUwQjkiLz4KPHN0b3Agb2Zmc2V0PSIwLjk3IiBzdG9wLWNvbG9yPSIjMTlGQjlCIi8+CjwvbGluZWFyR3JhZGllbnQ+CjxjbGlwUGF0aCBpZD0iY2xpcDBfNDc2XzI0MzAiPgo8cmVjdCB3aWR0aD0iMzEyLjkzIiBoZWlnaHQ9IjI4MC4zNzciIGZpbGw9IndoaXRlIi8+CjwvY2xpcFBhdGg+CjwvZGVmcz4KPC9zdmc+Cg==&color=9945FF" /></a>
<a href="https://www.npmjs.com/package/@marinade.finance/validator-bonds-cli"><img src="https://img.shields.io/npm/v/%40marinade.finance%2Fvalidator-bonds-cli?logo=npm&color=377CC0" /></a>

Mono repository for Validator Bonds product

## Repository structure

* [`programs/validator-bonds`](./programs/validator-bonds/) - Anchor on-chain contract project 
* [`packages/`](./packages/) - TypeScript packages related to on-chain program (SDK, CLI)
  ([SDK](./packages/validator-bonds-sdk/), [CLI](./packages/validator-bonds-cli/))
* [`api/`](./api/) - in Rust developed OpenAPI service that publishes bonds data ([API endpoint](https://validator-bonds-api.marinade.finance/docs))
* [`bonds-collector`](./bonds-collector/) - a CLI tool for loading on-chain bond data into a YAML file
* [`.buildkite/`](./.buildkite/) - automated pipelines that prepare data for bonds claiming, updating API data and similar
* [`settlement-distribution/`](settlement-distributions/) - CLIs for generating Settlement and Merkle Tree JSON data,
  which serve as the foundation for on-chain initialization and claim settlement transactions
* [`merkle-tree/`](./merkle-tree/) - generic Rust library implementing the merkle tree data structure management
* [`migrations/`](./migrations/) - SQL scripts to prepare and change DB schemas
* [`scripts/`](./scripts/) - scripts used in pipeline and to manage and integrate various repository parts
* [`settlement-pipelines`](./settlement-pipelines/) - a set of CLI binaries that works as a pipeline off-chain management for the Validator Bonds Program 

## Validator Bonds Programs Flow

![Validator Bonds Workflow](./resources/diagram/validator-bonds-workflow.svg)

The system works with flow of data.
The flow is encoded in code within [`buildkite` pipelines](./.buildkite)

- `scheduler`: Checks the epoch and makes processing happens each one
- `copy-parsed-snapshot`: Gets data from [`gs://marinade-solana-snapshot-mainnet`](./scripts/fetch-parsed-snapshot.bash)
- `prepare-*`: Creates JSON data that reflects bidding and PSR events, the data is stored at GCloud
  (data is publicly available but google login is required)
  at https://console.cloud.google.com/storage/browser/marinade-validator-bonds-mainnet
- `init-settlements`: Creating the [`Settlement`](./programs/validator-bonds/src/state/settlement.rs) accounts
   based on the generated JSON data, settlements are created by public key `bnwBM3RBrvnVmEJJAWEGXe81wtkzGvb9MMWjXcu99KR`
- `fund-settlements`: Funds the `Settlement accounts` from the Bonds account based on data loaded by `init-settlements`
- `claim-settlements`: Claims the `Settlement accounts` to distribute SOL to holders affected by PSR (protected events),
   bidding or other settlement events
  or other reasons of creating the settlement
- `close-settlements` Reset (close) the `Settlement accounts` when they expire
  (defined in `Config` by value of field `epochs_to_claim_settlement`)



## Development

### User related CLI from source

To run the CLI you need to have installed Node.js in version 16+ and `pnpm`.
For details on CLI options see [validator-bonds-cli README](./packages/validator-bonds-cli/README.md).

```sh
# installing TS dependencies
pnpm install
# run CLI
pnpm cli --help
```

### Validator Bonds data loading

A CLI tool that loads on-chain data and stores it in a YAML file.
The YAML file can then be used as a DTO for storing the data in a PostgreSQL database,
which is accessed by a REST API to serve the data.

```sh
cargo build --release

# Collect bonds data in YAML format
./target/release/bonds-collector \
  collect-bonds -u "$RPC_URL" > bonds.yaml

# Store YAML bonds data to a POSTGRES DB
./target/release/validator-bonds-api-cli \
  store-bonds --postgres-url "$POSTGRES_URL" --input-file bonds.yaml
```

### Validator Bonds API

```sh
cargo build --release

# Run API on port 8000 (default) or set a custom one using --port
./target/release/api \
  --postgres-url "$POSTGRES_URL" \
  --postgres-ssl-root-cert "$POSTGRES_SSL_ROOT_CERT"
```

### On-Chain related parts

For details for on-chain part see
[validator-bonds README](./programs/validator-bonds/README.md).

Contract audits:

* [Neodyme](https://neodyme.io), tag [`contract-v1.4.0`](https://github.com/marinade-finance/validator-bonds/tree/contract-v1.4.0), commit `7e6d35e`, see [audit document](./resources/audit/v1.4.0-neodyme-audit-validator-bonds.pdf)
* [Neodyme](https://neodyme.io), tag [`contract-v2.1.0`](https://github.com/marinade-finance/validator-bonds/tree/contract-v2.1.0), commit `4a5b009`, see [audit document](./resources/audit/v2.1.0-neodyme-audit-validator-bonds.pdf)

For information on tracking on-chain transactions, refer to the [On-Chain Analysis](./programs/validator-bonds/ON_CHAIN_ANALYSIS.md) document.

To build the Anchor program use the [`scripts`](./package.json) of the `pnpm`.

```sh
# install TS dependencies
pnpm install

# building Anchor program + cli and sdk TS packages
pnpm build

# testing the SDK+CLI against the bankrun and local validator
pnpm test
# running single cargo test
cargo test --package bid-psr-distribution ts_cross_check_hash_generate

# bankrun part of the tests
pnpm test:bankrun

# local validator part of the tests
# NOTE: for testing is needed nodejs20 because of support of `crypto` package used for generating test data
pnpm test:validator

# cargo tests in rust code
pnpm test:cargo
```

#### Contract deployment

```sh
VERSION='v'`grep version programs/validator-bonds/Cargo.toml | sed 's/.*"\([^"]\+\)".*/\1/'`
echo "Building version $VERSION"
anchor build --verifiable \
  --env "GIT_REV=`git rev-parse --short HEAD`" --env "GIT_REV_NAME=${VERSION}"

# 1. DEPLOY
## deploy (devnet, hot wallet upgrade)
solana program deploy -v -ud \
   --program-id vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4 \
   -k [fee-payer-keypair]
   --upgrade-authority [path-to-keypair] \
   ./target/verifiable/validator_bonds.so

# deploy (mainnet, SPL Gov authority multisig, governance 7iUtT...wtBZY)
# NOTE: solana version 1.18.x; `--with-compute-unit-price --use-rpc --use-quic` fixing the congestion of the network
#       check the latest available Solana client version at https://docs.solanalabs.com/cli/install
solana -um -k [fee-payer-keypair] \
    program write-buffer target/verifiable/validator_bonds.so \
    --with-compute-unit-price 10 \
    --use-rpc --use-quic
solana -um -k [fee-payer-keypair] \
    program set-buffer-authority \
    --new-buffer-authority 6YAju4nd4t7kyuHV6NvVpMepMk11DgWyYjKVJUak2EEm <BUFFER_PUBKEY>


# 2. IDL UPDATE, idl account Du3XrzTNqhLt9gpui9LUogrLqCDrVC2HrtiNXHSJM58y)
# NOTE: 'Error processing Instruction 0: custom program error: 0x7d3' means wrong IDL authority
## publish IDL (devnet, hot wallet)
anchor --provider.cluster devnet idl \
  --provider.wallet [idl-authority-and-fee-payer-keypair] \
  # init vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4 \
  upgrade vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4 \
  -f ./target/idl/validator_bonds.json

## publish IDL (mainnet, spl gov)
anchor idl write-buffer --provider.cluster mainnet --provider.wallet [fee-payer-keypair] \
  --filepath target/idl/validator_bonds.json vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4
anchor idl set-authority --provider.cluster mainnet --provider.wallet [fee-payer-keypair] \
  --new-authority 6YAju4nd4t7kyuHV6NvVpMepMk11DgWyYjKVJUak2EEm --program-id vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4 \
  <BUFFER_PUBKEY>

## in case a need of base64 anchor update
anchor idl --provider.cluster mainnet set-buffer --print-only \
  --buffer <BUFFER_PUBKEY> vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4


# 3.check verifiable deployment (<BUFFER_PUBKEY> can be verified as well)
#   a) when the target/verifiable/.so has been built already use switch --skip-build
COMMIT_HASH=`git rev-parse --short HEAD`
anchor --provider.cluster mainnet \
   verify -p validator_bonds \
   --env "GIT_REV=${COMMIT_HASH}" --env "GIT_REV_NAME=${VERSION}" \
   # --skip-build \
   <PROGRAM_ID_or_BUFFER_ID>

# 3.b upload the verified build to OtterSec API to be considered a Verified Build
#     see https://github.com/Ellipsis-Labs/solana-verifiable-build
solana-verify verify-from-repo https://github.com/marinade-finance/validator-bonds \
  --library-name validator_bonds \
  --program-id vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4 --commit-hash "${COMMIT_HASH}" \
  -- --config env.GIT_REV=\'${COMMIT_HASH}\' --config env.GIT_REV_NAME=\'${VERSION}\'
```
