# Validator Bonds API

Validator Bonds API serves on-chain data about validator bonds out of
[marinade-directory](https://github.com/marinade-finance/marinade-directory), a versioned JSON
document store over a bucket. One document holds one whole set:

| path                                     | written by                                                | read by                                            |
| ---------------------------------------- | --------------------------------------------------------- | -------------------------------------------------- |
| `/bonds/{bidding,institutional}/{epoch}` | `validator-bonds-api-cli store-bonds`                     | `/bonds/{type}`, `/v1/validators/protected`        |
| `/bonds/stake/{epoch}`                   | `validator-bonds-api-cli store-collected-stake`           | `/v1/validators/stake`, `/v1/validators/protected` |
| `/bonds/direct-staking-allocation`       | `validator-bonds-api-cli store-direct-staking-allocation` | `/v1/protected-events/allocation`                  |
| `/bonds/eventing/{type}`                 | `bonds-eventing`                                          | `/bonds/bidding/auction`                           |

The API reads with a token granted `/bonds/**:ro`; each store command needs `:rw` on the prefix
it writes.

## Development

### A store of your own

The store image is not published anywhere, so build it from a checkout of
[marinade-directory](https://github.com/marinade-finance/marinade-directory) first:

```bash
docker build -t marinade-directory:test /path/to/marinade-directory
```

```bash
GCS_PORT=4443
STORE_PORT=8080
SECRET='local-secret-key-at-least-32-bytes'

docker run -d --rm --name bonds-gcs --network host fsouza/fake-gcs-server:1.56.1 \
  -backend memory -scheme http -port "$GCS_PORT" -public-host "localhost:$GCS_PORT"
curl -X POST "http://localhost:$GCS_PORT/storage/v1/b?project=validator-bonds" \
  -H 'Content-Type: application/json' \
  -d '{"name":"bonds","versioning":{"enabled":true}}'

docker run -d --rm --name bonds-store --network host \
  -e "STORAGE_EMULATOR_HOST=localhost:$GCS_PORT" -e GCS_BUCKET=bonds \
  -e "JWT_SECRET=$SECRET" -e "PORT=$STORE_PORT" -e METRICS_PORT=0 \
  marinade-directory:test

export DIRECTORY_URL="http://localhost:$STORE_PORT"
```

Mint an HS256 token against that secret. Grants carry a leading slash — `bonds/**:rw` matches
nothing:

```bash
b64() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
HEADER=$(printf '{"alg":"HS256","typ":"JWT"}' | b64)
CLAIMS=$(printf '{"sub":"local","grants":["/bonds/**:rw"],"exp":%s}' "$(($(date +%s)+3600))" | b64)
export DIRECTORY_TOKEN="$HEADER.$CLAIMS.$(printf '%s' "$HEADER.$CLAIMS" \
  | openssl dgst -sha256 -hmac "$SECRET" -binary | b64)"
```

### Storing bonds

```bash
cargo run --bin validator-bonds-api-cli -- store-bonds --input-file bonds.yaml

# data is gzipped so we use curl --compressed
curl -X GET --compressed "http://localhost:8000/bonds/bidding"
curl -X GET --compressed "http://localhost:8000/v1/validators/protected"

# the latest collected epoch, as a one-element `epochs` array
curl -X GET --compressed "http://localhost:8000/v1/validators/stake"

# an epoch range, newest first, at most 100 epochs wide
curl -X GET --compressed "http://localhost:8000/v1/validators/stake?from_epoch=1020&to_epoch=1030"

# only the direct-staking in-flow and out-flow, across that range
curl -X GET --compressed "http://localhost:8000/v1/validators/stake?from_epoch=1020&to_epoch=1030&label=direct,direct-exit"
```

### Storing collected stake

`label` and `vote_account` are comma-separated lists, not repeated parameters. `totals` aggregate
only the rows the filters returned. An epoch missing from the range was never collected — the
collector runs on the bidding run of `collect-bonds.yml` alone — and nothing is interpolated.

#### Reading stake out-flow

Exiting rotates the staker authority to the product's exit authority _before_ deactivating, so a
product's own label never shows out-flow — `direct.deactivating` is structurally zero. Pair the two
labels (`label=direct,direct-exit`) to see a product's in-flow and out-flow together.

- `direct-exit.deactivating` in epoch N is stake that **entered cooldown** in epoch N. That is not
  necessarily the epoch the exit was initiated in: rotating the authority and requesting
  deactivation are separate transactions and need not land in the same epoch.
- `direct-exit.effective` is stake still cooling down at that snapshot. `deactivating` is a subset
  of it, so active-only is `effective - deactivating`.
- Cooldown lasts one epoch and there is one snapshot per epoch, so **a missed collection loses that
  out-flow event permanently**. The endpoint is a per-epoch signal, not a cumulative ledger.
- A position that has finished cooling down is no longer reported, and neither is stake an exit
  authority holds without delegating it — there is no vote account to attribute it to. At epoch 1030
  that was 73.2 SOL under `select-exit`.

`direct-exit` and `select-exit` routinely have no rows at all: the collector writes a row only where
an authority has non-zero stake on a validator. They stay valid `label` filters regardless, and an
empty result for one means "nothing was exiting", not "unknown label".

`/v1/validators/protected` sizes each bond against the stake routed to the validator through the
Marinade products listed in `collector-config.yaml`, so it needs the stake document:

```bash
cargo run --bin bonds-collector -- collect-stake \
    --config ./collector-config.yaml > collected-stake.yaml
cargo run --bin validator-bonds-api-cli -- store-collected-stake \
    --input-file collected-stake.yaml
```

With nothing stored the endpoint answers 500 rather than an empty list, which would read as "no
validator is protected".

### Accessing the API

```bash
cargo run --bin api -- \
  --verified-validators-config ./verified-validators.yaml  # see verified-validators.yaml.example

# data is gzipped so we use curl --compressed
curl -X GET --compressed "http://localhost:8000/bonds/bidding"
curl -X GET --compressed "http://localhost:8000/v1/validators/protected"
curl -X GET --compressed "http://localhost:8000/v1/validators/stake"
```

### Storing the direct staking allocation

`/v1/protected-events/allocation` reports which bond paid each validator's direct-staking PSR
claims, and which validators had no usable bond at all. That cannot be derived from settlements — a
validator with no usable bond produces no settlement — so it comes from the allocator's report,
stored by the `store-direct-staking-allocation` step of `.buildkite/prepare-direct-staking-distribution.yml`:

```bash
cargo run --bin validator-bonds-api-cli -- store-direct-staking-allocation \
    --input-file direct-staking-allocation-report.json

curl -X GET --compressed "http://localhost:8000/v1/protected-events/allocation"
curl -X GET --compressed "http://localhost:8000/v1/protected-events/allocation?from_epoch=1030"
```

Every run lands in the one document `/bonds/direct-staking-allocation`, keyed by epoch, because the
endpoint serves the whole history and the store lists nothing. The store replaces the report's epoch
wholesale, so re-running it is idempotent. A report that routed nothing is legal — epoch 1020 was
the first direct-staking run and both buckets were empty — and stores an epoch with no rows, which
the endpoint reports as nothing for that epoch. With nothing stored at all the endpoint answers 500
rather than an empty list, which would read as "nobody was left unprotected"; a `from_epoch` past
every stored epoch answers 200 with an empty list.

## Tests

`api/tests/http_behavior.rs` covers routing and middleware; `api/tests/directory_store.rs` drives
the store commands and the routes — including direct staking allocation — against a store of its
own, started with `docker` by `api/tests/common/mod.rs`. Without `docker` those tests say so and
pass.
