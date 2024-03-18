# Validator Bonds CLI

CLI for Validator Bonds contract.

## Working with CLI

To install the CLI as global npm package

**Requirements:** Node.js version 16 or higher.

See

```bash
npm i -g @marinade.finance/validator-bonds-cli
validator-bonds --help
```

Successful installation will be shown in similar fashion to this output

```
npm i -g @marinade.finance/validator-bonds-cli

added 165 packages in 35s

17 packages are looking for funding
  run `npm fund` for details

# to verify installed version
validator-bonds --version
1.1.12
```

### Creating a bond

Any validator may create a bond account.

The bond account is strictly coupled with a vote account.

It can be created in two ways:

* permission-ed: `--validator-identity <keypair-wallet>` signature is needed.
  One may then configure additional authority that permits future changes at the bond account
  with argument `--bond-authority` (the bond authority can be set at this point to anything).
* permission-less: anybody may create the bond account. For any future configuration change
  of bond account, or for withdrawal funds, the validator identity signature is needed
  (the bond authority is set to identity of the validator at this point).

On the bond account:

* there can be only one bond for a vote account
* every bond is attached to a vote account

```sh
# permission-ed: bond account at mainnet
validator-bonds -um init-bond -k <fee-payer-keypair> \
  --vote-account <vote-account-pubkey> --validator-identity <validator-identity-keypair> \
  --bond-authority <authority-on-bond-account-pubkey> \
  --rent-payer <rent-payer-account-keypair>

# permission-less: bond account at mainnet
validator-bonds -um init-bond -k <fee-payer-keypair> \
  --vote-account <vote-account-pubkey> --rent-payer <rent-payer-account-keypair>

# to configure bond account properties
validator-bonds -um configure-bond --help
```

#### Bond creation details

The `init-bond` command initiates the creation of an account on the blockchain containing configuration data specific to a particular bond. This bond account is intricately linked with a corresponding vote account. The creation of a bond account requires a validator's identity signature, specifically one associated with the vote account.

The parameters and their meanings are explained in detail below:

* `--k <fee-payer-keypair>:` This parameter designates the account used to cover transaction costs (e.g., `5000` lamports).
* `--vote-account`: Specifies the vote account on which the bond will be established.
* `--validator-identity`: Represents the required signature; the validator identity must match one within the designated vote account.
* `--bond-authority`: Refers to any public key with ownership rights. It is recommended to use a ledger or multisig. This key does not necessarily need to correspond to an existing on-chain account (SOL preloading is unnecessary).
* `--rent-payer`: This account covers the creation cost of the Solana bond account, and it is expected to be the same as the fee payer (default).
   The rent cost is `0.00270048` SOL. Note that the `--rent-payer` is unrelated to bond security or "funding," which is addressed through a separate instruction. The bond's security is established by providing a stake account. The lamports in the stake account then corresponds to the SOL amount added to the security of the bond account. There is no direct payment of SOLs to the bond; it is accomplished solely by allocating stake accounts.

### Show the bond account

```sh
validator-bonds -um show-bond <bond-or-vote-account-address> -f yaml

# to check with vote account address
validator-bonds -um show-bond --config vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU --validator-vote-account <vote-account-address>
```

Expected output on created bond is like

```
validator-bonds -um show-bond ...
{
  programId: 'vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4',
  publicKey: '...',
  account: {
    config: 'vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU',
    validatorVoteAccount: '...',
    authority: '...',
    bump: 255,
  }
}
```

### Bond account configuration

The bond account configures the authority public key.
To both fund the bond and withdraw the funds, either the authority signature
or the validator identity (linked to the bond account's vote account) is required.

When creating the bond account in a permission-ed manner (as described in [section Creating a Bond](#creating-a-bond)), the authority can be defined upfront. If one prefers not to sign the CLI transaction with the validator `identity key`, they can utilize the [*mint-configure*](#permission-less-mint---configure-workflow) workflow.

When `authority` is configure then use

```sh
pnpm cli -um configure <bond-or-vote-account-address> \
  --authority <authority-or-validator-identity.keypair> \
  --bond-authority <new-bond-authority-pubkey>
```

#### Permission-less Mint - Configure workflow

The owner of the `validator identity` key has permission to configure the bond account. To verify the ownership of the validator identity key without requiring the CLI-generated transaction signature and sending it on-chain, one can use Bond's token minting. Use the command `mint-bond`:

```sh
pnpm cli -um mint-bond <bond-or-vote-account-address>
```

After execution of this command a Bond program creates a SPL token
that is transferred to wallet of the `validator identity`.
The owner of the `validator identity` may transfer the token
to whatever other account (by standard means).
Later when she wants to configure the bonds account it's required verify
ownership of the Bond's SPL token.
The owner of the token (which can be different to original `validator identity`)
has to sign the CLI command and the program burns the Bond's SPL token
and permits configuration of the `authority`.

After executing this command, the Bond program creates an SPL token that
is transferred to the wallet of the `validator identity`.
The owner of the `validator identity` keypair may transfer the token
to any other account using standard means.
Later, when they want to configure the bond account,
it's required to verify ownership of the Bond's SPL token.
The owner of the token signs the CLI generated transaction,
and the Bonds program burns the Bond's SPL token, allowing configuration of the authority.

```sh
pnpm cli -um configure <bond-or-vote-account-address> \
  --authority <spl-token-owner.keypair> \
  --bond-authority <new-bond-authority-pubkey> \
  --with-token
```


### Funding bond account

The bond account exists to be funded, where the funds may be used to cover a protected event
when a validator under-performs or experiences a serious issue.
"Funding the bond" involves charging lamports to a stake account and
then assigning ownership of the stake account to the Validator Bonds program using the `fund-bond` CLI command.

* The stake account **must be delegated** to the vote account belonging to the bond account.
* The stake account **must be fully activated**.

All lamports held in the stake accounts are considered part of the protected stake amount.

```sh
validator-bonds -um fund-bond <bond-or-vote-account-address> \
  --stake-account <stake-account-address> \
  --stake-authority <withdrawer-stake-account-authority>
```

### Withdrawing bond account

When one does not want to participate in covering the [protected events](https://marinade.finance/blog/introducing-protected-staking-rewards/)
she may withdraw the funds by assigning the ownership of the stake accounts
back to the original owner.

When someone chooses not to participate in covering the [protected events](https://marinade.finance/blog/introducing-protected-staking-rewards/),
they can withdraw the funds by transferring the ownership of the stake accounts back to the original owner.

This process involves two steps. First, create an initial *withdraw request*, which is an on-chain ticket (an account) informing the protected event system
about the intention to withdraw funds. Only after the lockup time elapses
(a configuration property defined in the Bonds configuration),
one can call to claim the *withdraw request* and regain ownership of the funds held within the stake account.

NOTE: The amount declared in the *withdraw request* is no longer considered as part of the funded bond amount.

To check the Bonds configuration data use `show-config` command.
et Marinade config account address is `vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU`
and verify the value 'withdrawLockupEpochs' to find required number of epochs to have the *withdraw request* claimable.

```sh
pnpm cli -um show-config vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU
```

To initialize the *withdraw request* and later claim it,
use the following CLI commands. Both commands require the signature of the Bond's authority.

To initialize the *withdraw request*, one needs to define the maximum number of lamports that is requested to be withdrawn upon claiming.
For claiming, one may define `--withdrawer` as the public key where the claimed stake accounts will be assigned
(by withdrawer and staker authorities).

```sh
pnpm cli -um init-withdraw-request <bond-or-vote-account-address> \
  --authority <bond-authority.keypair> \
  --amount <number-of-requested-lamports-to-be-withdrawn>

pnpm cli -um claim-withdraw-request <withdraw-request-or-bond-account-address> \
  --authority <bond-authority.keypair> \
  --withdrawer <user-pubkey>
```


The *withdraw request* can be cancelled at any time.

If the Bond owner desires to change the withdrawal amount or wishes to return the amount to be considered as funded bonds again,
they need to cancel the existing request and potentially create a new withdrawal request later on.

```sh
pnpm cli -um cancel-withdraw-request <withdraw-request-or-bond-account-address> \
  --authority <bond-authority.keypair>
```

## Support for Ledger signing

Any signature can be generated using Ledger by specifying either the pubkey 
(`usb://ledger/9rPVSygg3brqghvdZ6wsL2i5YNQTGhXGdJzF65YxaCQd`) or the path (`usb://ledger?key=0/0`)
as the parameter value.
For instance, if the bond authority is set up to be controlled by a key managed on Ledger, the command can be executed as follows:

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

Usage: src [options] [command]

Options:
  -V, --version                                        output the version number
  -u, --cluster <cluster>                              solana cluster URL or a moniker (m/mainnet/mainnet-beta, d/devnet, t/testnet, l/localhost) (default: "mainnet")
  -c <cluster>                                         alias for "-u, --cluster"
  -k, --keypair <keypair-or-ledger>                    Wallet keypair (path or ledger url in format usb://ledger/[<pubkey>][?key=<derivedPath>]). Wallet keypair is used to pay for the transaction fees and as default value for
                                                       signers. (default: ~/.config/solana/id.json)
  --program-id <pubkey>                                Program id of validator bonds contract (default: vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4)
  -s, --simulate                                       Simulate (default: false)
  -p, --print-only                                     Print only mode, no execution, instructions are printed in base64 to output. This can be used for placing the admin commands to SPL Governance UI by hand. (default: false)
  --skip-preflight                                     transaction execution flag "skip-preflight", see https://solanacookbook.com/guides/retrying-transactions.html#the-cost-of-skipping-preflight (default: false)
  --commitment <commitment>                            Commitment (default: "confirmed")
  --confirmation-finality <confirmed|finalized>        Confirmation finality of sent transaction. Default is "confirmed" that means for full cluster finality that takes ~8 seconds. (default: "confirmed")
  -d, --debug                                          printing more detailed information of the CLI execution (default: false)
  -v, --verbose                                        alias for --debug (default: false)
  -h, --help                                           display help for command

Commands:
  init-config [options]                                Create a new config account.
  configure-config [options] [config-account-address]  Configure existing config account.
  init-bond [options]                                  Create a new bond account.
  configure-bond [options] [bond-account-address]      Configure existing bond account.
  merge [options]                                      Merging stake accounts belonging to validator bonds program.
  fund-bond [options] [bond-account-address]           Funding a bond account with amount of SOL within a stake account.
  show-config [options] [address]                      Showing data of config account(s)
  show-event [options] <event-data>                    Showing data of anchor event
  show-bond [options] [address]                        Showing data of bond account(s)
  help [command]                                       display help for command
```

## FAQ and issues

* **npm WARN EBADENGINE Unsupported engine {**

  When running the `validator-bonds` cli the error continues as
  ```
  validator-bonds --help
  /usr/local/lib/node_modules/@marinade.finance/validator-bonds-cli/node_modules/@solana/web3.js/lib/index.cjs.js:645
          keyMeta.isSigner ||= accountMeta.isSigner;
                            ^

  SyntaxError: Unexpected token '='
  ...
  ```

  **Solution:** old version of Node.js is installed on the machine. Node.js upgrade to version 16 or later is needed.

* **ExecutionError: Transaction XYZ not found**

  The CLI sent the transaction to blockchain but because of a connection
  or RPC issue the client was not capable to verify that the transaction
  has been processed successfully on chain

  ```
  err: {
        "type": "ExecutionError",
        "message": "... : Transaction ... not found, failed to get from ...",
        "stack":
            Error: ...
                at executeTx (/usr/local/lib/node_modules/@marinade.finance/validator-bonds-cli/node_modules/@marinade.finance/web3js-common/src/tx.js:86:15)
  ```

  **Solution:** Verify if the transaction `XYX` is at blockchain with a transaction explorer,
  e.g., https://explorer.solana.com/.
  Verify with the CLI. For example when bond should be initialized (`init-bond`)
  you can run search with CLI `validator-bonds -um show-bond --validator-vote-account <vote-account>`
  to check if account was created.

* **bigint: Failed to load bindings, ...**

  CLI shows error `the bigint: Failed to load bindings, pure JS will be used (try npm run rebuild?)`
  is caused by system configuration requirements from `@solana/web3.js` (details at https://solana.stackexchange.com/questions/4077/bigint-failed-to-load-bindings-pure-js-will-be-used-try-npm-run-rebuild-whe). No functionality issues with this error.

  **Solution:** All works fine, nothing needed.
