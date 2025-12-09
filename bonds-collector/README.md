# Validator Bonds Collector

Collecting on-chain data about validator bonds and storing it to YAML file.
The collected data is used by API store CLI tool to populate the database.

## Development

```bash
export RPC_URL=...
cargo run --bin bonds-collector -- collect-bonds \
    --bond-type bidding | tee bonds.yaml
```

### Using Surfpool

To be able to do changes in bond accounts that are collected we can use Surfpool
as a proxy to existing bonds accounts on mainnet.

**NOTE:** see installation instructions for Surfpool: https://docs.surfpool.run/install

The cookbook that deploys the validator-bonds collector with Surfpool is located
in [runbooks directory](../runbooks/)

**WARNING:** to deploy the validator-bonds contract run the `surfpool start` from the root directory of the project

Check [Surfpool documentation](https://docs.surfpool.run/rpc/cheatcodes#surfnet-setaccount) for details on `surfnet` commands.

```bash
# starting surfpool with mainnet RPC
export RPC_URL=...
surfpool start --rpc-url "$RPC_URL"

RPC_URL='http://127.0.0.1:8899'
cargo run --bin bonds-collector -- collect-bonds \
    --bond-type bidding | tee tmp-bonds.yaml

# surfpool account edit HTTP command
export RPC_ENDPOINT="http://localhost:8899"
PROGRAM_ID=vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4
export PUBKEY="account to be edited pubkey"
export DATA_HEX="The new account data, as a hex encoded string"

curl -X POST "$RPC_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "surfnet_setAccount",
    "params": [
      "'"$PUBKEY"'",
      {
        "lamports": 1000000000,
        "data": "'"$DATA_HEX"'",
        "executable": false,
        "rent_epoch": 0,
        "owner": "'"$PROGRAM_ID"'"
      }
    ]
}'
```
