# Validator Bonds - Pipeline Sanity Check

CLI to check sanity of past and current epoch validator bonds program data.

## Usage

### 1) Getting input data

```bash
mkdir -p ./data
epoch=850
past_epochs_to_check=10
for one_epoch in $(seq $((epoch - past_epochs_to_check)) $epoch); do
  echo $one_epoch
  mkdir ./tmp
  gcloud storage cp  "gs://marinade-validator-bonds-mainnet/${one_epoch}/*settlements.json" ./tmp/
  for I in ./tmp/*; do
    mv "$I" "./data/${one_epoch}-$(basename $I)"
  done
  rm -rf ./tmp
done
```

### 2) Running the sanity check

```bash
pnpm cli:check check -c ./data/${epoch}-bid-distribution-settlements.json \
  -p ./data/!(${epoch})-bid-distribution-settlements.json \
  --correlation-threshold 15 --score-threshold 2 --verbose
```
