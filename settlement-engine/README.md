# Settlement Engine

## Usage

```bash
# Download input files from Google Storage
epoch=592
bucket=marinade-validator-bonds-mainnet
gcloud storage cp "gs://$bucket/$epoch/stakes.json" "gs://$bucket/$epoch/validators.json" .
gcloud storage cp "gs://$bucket/$((epoch - 1))/validators.json" "past-validators.json"
gcloud storage cp "gs://$bucket/$epoch/stakes.json" "stakes.json"

# Build & run
cargo run --release --bin settlement-engine-cli -- \
    --validator-meta-collection validators.json \
    --past-validator-meta-collection past-validators.json \
    --stake-meta-collection stakes.json \
    --output-protected-event-collection output-proteceted-event-collection.json \
    --output-settlement-collection output-settlement-collection.json \
    --output-merkle-tree-collection output-merkle-tree-collection.json \
    --settlement-config settlement-config.yaml
```
