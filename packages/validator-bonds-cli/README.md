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

## Support for Ledger signing

Any signature can be signed with Ledger when it's used the pubkey (`usb://ledger/9rPVSygg3brqghvdZ6wsL2i5YNQTGhXGdJzF65YxaCQd`) or the path (`usb://ledger?key=0/0`) as the parameter value.
For example, when the bond authority is configured to be managed with a key managed in Ledger
we can run like

```sh
# using solana-keygen to find pubkey on a particular derivation path
solana-keygen pubkey 'usb://ledger?key=0/3'

# using the ledger to sign as the authority to change the bond account configuration
validator-bonds -um configure-bond \
  --authority 'usb://ledger?key=0/3' --bond-authority <new-authority-pubkey> \
  <bond-account-address>
```

The support for ledger came from (`@marinade.finance/ledger-utils` TS implementation wrapper)[https://github.com/marinade-finance/marinade-ts-cli/tree/main/packages/lib/ledger-utils] around `@ledgerhq/hw-app-solana`. The implementation tries to be compatible with way how (`solana` CLI)[https://github.com/solana-labs/solana/blob/v1.14.19/clap-utils/src/keypair.rs#L613] behaves.




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