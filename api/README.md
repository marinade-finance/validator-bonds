# Validator Bonds API

Validator Bonds API serves on-chain data about validator bonds out of
[marinade-directory](https://github.com/marinade-finance/marinade-directory), a versioned JSON
document store over a bucket. One document holds one whole set:

| path                                     | written by                                      | read by                                            |
| ---------------------------------------- | ----------------------------------------------- | -------------------------------------------------- |
| `/bonds/{bidding,institutional}/{epoch}` | `validator-bonds-api-cli store-bonds`           | `/bonds/{type}`, `/v1/validators/protected`        |
| `/bonds/stake/{epoch}`                   | `validator-bonds-api-cli store-collected-stake` | `/v1/validators/stake`, `/v1/validators/protected` |
| `/bonds/eventing/{type}`                 | `bonds-eventing`                                | `/bonds/bidding/auction`                           |

The API reads with a token granted `/bonds/**:ro`; each store command needs `:rw` on the prefix
it writes.

## Development

### A store of your own

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
```

### Storing collected stake

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

## Tests

`api/tests/http_behavior.rs` covers routing and middleware; `api/tests/directory_store.rs` drives
the store commands and the routes against a store of its own, started with `docker` by
`api/tests/common/mod.rs`. Without `docker` those tests say so and pass.
