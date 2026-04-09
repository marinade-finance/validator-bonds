#!/bin/bash
# Downloads stakes.json for two consecutive epochs and produces scenario test fixtures:
#   - 20 validators with activating stake (got new delegation)
#   - 20 validators with only active stake (stable)
# Output: src/generators/fixtures/scenario_epoch_{N}.json and scenario_epoch_{N+1}.json
#
# Usage: ./fetch-scenario-fixtures.sh <epoch>
# Example: ./fetch-scenario-fixtures.sh 750

set -euo pipefail
cd "$(dirname "$0")"

EPOCH=${1:?Usage: $0 <epoch>}
EPOCH_NEXT=$((EPOCH + 1))
BUCKET="gs://marinade-validator-bonds-mainnet"
OUT="src/generators/fixtures"
mkdir -p "$OUT"

echo "downloading stakes for epochs $EPOCH and $EPOCH_NEXT..."
gsutil cp "$BUCKET/$EPOCH/stakes.json"      ./tmp/stakes_$EPOCH.json
gsutil cp "$BUCKET/$EPOCH_NEXT/stakes.json" ./tmp/stakes_$EPOCH_NEXT.json

echo "filtering validators..."
python3 - <<EOF
import json, collections

with open("tmp/stakes_$EPOCH.json") as f:
    s0 = json.load(f)
with open("tmp/stakes_$EPOCH_NEXT.json") as f:
    s1 = json.load(f)

# index epoch N+1 stakes by validator
by_validator = collections.defaultdict(lambda: {"active": 0, "activating": 0})
for stake in s1.get("stakeMetas", s1.get("stake_metas", [])):
    v = stake.get("validator")
    if not v:
        continue
    by_validator[v]["active"]     += stake.get("activeDelegationLamports",     stake.get("active_delegation_lamports", 0))
    by_validator[v]["activating"] += stake.get("activatingDelegationLamports", stake.get("activating_delegation_lamports", 0))

with_activating = [(v, d) for v, d in by_validator.items() if d["activating"] > 0 and d["active"] > 0]
stable          = [(v, d) for v, d in by_validator.items() if d["activating"] == 0 and d["active"] > 0]

with_activating.sort(key=lambda x: -x[1]["activating"])
stable.sort(key=lambda x: -x[1]["active"])

selected = set(v for v, _ in with_activating[:20]) | set(v for v, _ in stable[:20])
print(f"selected {len(selected)} validators ({len(with_activating[:20])} with activating, {len(stable[:20])} stable)")

def filter_stakes(data, validators):
    metas_key = "stakeMetas" if "stakeMetas" in data else "stake_metas"
    filtered = {**data, metas_key: [s for s in data[metas_key] if s.get("validator") in validators]}
    return filtered

out0 = filter_stakes(s0, selected)
out1 = filter_stakes(s1, selected)

with open("src/generators/fixtures/scenario_epoch_n.json",   "w") as f:
    json.dump(out0, f, indent=2)
with open("src/generators/fixtures/scenario_epoch_n1.json",  "w") as f:
    json.dump(out1, f, indent=2)

print("wrote src/generators/fixtures/scenario_epoch_n.json")
print("wrote src/generators/fixtures/scenario_epoch_n1.json")
EOF

echo "done. now run: cargo test -p bid-distribution scenario"
