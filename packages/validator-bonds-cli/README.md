# Validator Bonds CLI

CLI for Validator Bonds contract.

## Working with CLI

To install the CLI as global npm package

```bash
npm i -g @marinade.finance/validator-bonds-cli
validator-bonds --help
```

### Creating a bond

Any validator may create a bond account to protect the processing.
The bond account is bound to a validator vote account.

```sh
# bond account at mainnet
validator-bonds -um init-bond -k <fee-payer-keypair> \
  --vote-account <vote-account-pubkey> --validator-identity <validator-identity-keypair> \
  --bond-authority <authority-on-bond-account-pubkey> \
  --rent-payer <rent-payer-account-keypair>

# to configure bond account properties
validator-bonds -um configure-bond --help
```

### Show the bond account

```sh
validator-bonds -um show-bond <bond-account-address> -f yaml
```



## `validator-bonds CLI Reference`

### `validator-bonds cli --help`
```sh
validator-bonds cli --help

Usage: validator-bonds [options] [command]

Options:
  -V, --version                                        output the version number
  -u, --cluster <cluster>                              solana cluster URL, accepts shortcuts (d/devnet, m/mainnet) (default: "http://127.0.0.1:8899")
  -c <cluster>                                         alias for "-u, --cluster"
  --commitment <commitment>                            Commitment (default: "confirmed")
  -k, --keypair <keypair-or-ledger>                    Wallet keypair (path or ledger url in format usb://ledger/[<pubkey>][?key=<derivedPath>]). Wallet keypair is used to pay for the transaction fees and as default value for signers. (default: ~/.config/solana/id.json)
  --program-id <pubkey>                                Program id of validator bonds contract (default: vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4)
  -s, --simulate                                       Simulate (default: false)
  -p, --print-only                                     Print only mode, no execution, instructions are printed in base64 to output. This can be used for placing the admin commands to SPL Governance UI by hand. (default: false)
  --skip-preflight                                     transaction execution flag "skip-preflight", see https://solanacookbook.com/guides/retrying-transactions.html#the-cost-of-skipping-preflight (default: false)
  -d, --debug                                          printing more detailed information of the CLI execution (default: false)
  -v, --verbose                                        alias for --debug (default: false)
  -h, --help                                           display help for command

Commands:
  init-config [options]                                Create a new config account.
  configure-config [options] [config-account-address]  Configure existing config account.
  init-bond [options]                                  Create a new bond account.
  configure-bond [options] [bond-account-address]      Configure existing bond account.
  show-config [options] [address]                      Showing data of config account(s)
  show-event [options] <event-data>                    Showing data of anchor event
  show-bond [options] [address]                        Showing data of bond account(s)
  help [command]                                       display help for command
```