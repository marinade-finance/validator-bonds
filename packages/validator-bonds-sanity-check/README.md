# Validator Bonds - Pipeline Sanity Check

CLI to check sanity of past and current epoch validator bonds program data.

## Usage

### 1) Getting input data

```bash
DIR="${PWD}/data"
mkdir -p "$DIR"
epoch=857
past_epochs_to_check=10
for one_epoch in $(seq $((epoch - past_epochs_to_check)) $epoch); do
  echo $one_epoch
  mkdir "$DIR/tmp"
  gcloud storage cp  "gs://marinade-validator-bonds-mainnet/${one_epoch}/*settlements.json" "$DIR/tmp/"
  for I in "$DIR/tmp/"*; do
    mv "$I" "$DIR/${one_epoch}-$(basename $I)"
  done
  rm -rf "$DIR/tmp"
done
```

### 2) Running the sanity check

```bash
pnpm cli:check check -c "$DIR/${epoch}-bid-distribution-settlements.json" \
  -p "$DIR/!(${epoch})-bid-distribution-settlements.json" \
  --correlation-threshold 15 --score-threshold 2 --verbose --type bid

pnpm cli:check check -c "$DIR"/857-bid-psr-distribution-settlements.json \
  -p $(seq -f "$DIR"/%g-bid-psr-distribution-settlements.json 845 856) --type psr
```

### 3) Verification of settlements and merkle tree consistency

```bash
epoch=857
DIR="${PWD}/data-${epoch}"
mkdir -p "$DIR"
gcloud storage cp  "gs://marinade-validator-bonds-mainnet/${epoch}/*settlement*.json" "$DIR"

pnpm cli:check check-settlement -s "${DIR}/bid-distribution-settlements.json" \
  -m "${DIR}/bid-distribution-settlement-merkle-trees.json"
```
