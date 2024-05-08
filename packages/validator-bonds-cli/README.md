# Validator Bonds CLI

CLI for Validator Bonds contract.

## Working with CLI

To install the CLI as global npm package

```sh
npm i -g @marinade.finance/validator-bonds-cli@latest
```

For detailed information on NPM packages installation and
execution see section [NPM package installation](#npm-packages-installation-and-execution).

Successful installation will be shown in similar fashion to this output

```
added 165 packages in 35s

17 packages are looking for funding
  run `npm fund` for details

# to verify installed version
validator-bonds --version
1.3.6
```

To get info on available commands

```sh
validator-bonds --help
```

**Requirements:** Node.js version 16 or higher.

## Required steps for a validator to be eligible for stake distribution

* [creating a bond](#creating-a-bond)
* [funding the bond](#funding-bond-account)
* [during the time of tracking, the bond is sufficiently funded](#show-the-bond-account)


### Creating a bond

A bond account can be created for any validator.

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
```

Expected output on created bond is like

```
{
  programId: 'vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4',
  publicKey: '...',
  account: {
    config: 'vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU',
    voteAccount: '...',
    authority: '...'
  },
  amountActive: 10024261277,
  amountAtSettlements: 0,
  amountToWithdraw: 0,
  numberActiveStakeAccounts: 1,
  numberSettlementStakeAccounts: 0,
  withdrawRequest: '<NOT EXISTING>'
}
```

### Bond account configuration

The bond account configures the authority public key.
To both fund the bond and withdraw the funds, either the authority signature
or the validator identity (linked to the bond account's vote account) is required.

When creating the bond account in a permission-ed manner (as described in [section Creating a Bond](#creating-a-bond)), the authority can be defined upfront. If one prefers not to sign the CLI transaction with the validator `identity key`, they can utilize the [*mint-configure*](#permission-less-mint---configure-workflow) workflow.

When `authority` is configure then use

```sh
validator-bonds -um configure-bond <bond-or-vote-account-address> \
  --authority <authority-or-validator-identity.keypair> \
  --bond-authority <new-bond-authority-pubkey>
```

#### Permission-less Mint - Configure workflow

**An alternative step**, the permission-less mint workflow is available only for special
purposes. For configuration, it is typically recommended to use the validator identity
signature, as described in [bond account configuration](#bond-account-configuration).

The owner of the `validator identity` key has permission to configure the bond account. To verify the ownership of the validator identity key without requiring the CLI-generated transaction signature and sending it on-chain, one can use Bond's token minting. Use the command `mint-bond`:

```sh
validator-bonds -um mint-bond <bond-or-vote-account-address>
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
validator-bonds -um configure-bond <bond-or-vote-account-address> \
  --authority <spl-token-owner-keypair> \
  --bond-authority <new-bond-authority-pubkey> \
  --with-token
```

### Funding Bond Account

The bond account exists to be funded, where the funds may be used to cover a protected event
when a validator under-performs or experiences a serious issue.
"Funding the bond" consists of two steps:

1. Charging lamports to a stake account.
2. Assigning ownership of the stake account to the Validator Bonds program using
   the `fund-bond` CLI command.

The funded stake account:

- **Must be delegated** to the vote account belonging to the bond account.
- **Must be fully activated**.

All lamports held in the stake accounts are considered part of the protected stake amount.

```sh
validator-bonds -um fund-bond <bond-or-vote-account-address> \
  --stake-account <stake-account-address> \
  --stake-authority <withdrawer-stake-account-authority-keypair>
```

The meanings of parameters are as follows:

- `<bond-or-vote-account-address>`: bond account that will be funded by the amount of
  lamports from the stake account.
- `--stake-account`: address of the stake account that will be assigned under the bonds program.
- `--stake-authority`: signature of the stake account authority that permits to change the
  stake account authorities

#### Bond Account initialization and funding SHOWCASE (credits to [Bored King](https://twitter.com/bape_SOL))

```sh
validator-bonds init-bond --vote-account <vote-account-address> \
  --validator-identity ./identity.json --keypair ./identity.json
> Bond account BondAddress9iRYo3ZEK6dpmm9jYWX3Kb63Ed7RAFfUc of config vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4 successfully created

solana-keygen grind --starts-with bnd:1
> Optional: Grind is used to remind the key is for bond a bond.
> bndk55Q9YntUzpHvnAy9bcbtdHYfFjANUfjsCECF1ba.json

solana create-stake-account ./bndk55Q9YntUzpHvnAy9bcbtdHYfFjANUfjsCECF1ba.json <Amount of SOL 1 for every 10,000 staked>

solana delegate-stake ./bndk55Q9YntUzpHvnAy9bcbtdHYfFjANUfjsCECF1ba.json <Vote Pubkey>

<wait for stake to activate in next epoch>

validator-bonds fund-bond BondAddress9iRYo3ZEK6dpmm9jYWX3Kb63Ed7RAFfUc \
  --stake-account bndk55Q9YntUzpHvnAy9bcbtdHYfFjANUfjsCECF1ba --keypair ./identity.json
```

#### How to add more funds under the bond?

It's as simple as creating a new stake account and funding it into the bond program.
The amounts of SOLs delegated to the same validator are summed together.
The validator bonds program may merge or split the accounts delegated to the same validator.
It's not guaranteed to maintain the same stake accounts in the bond,
but the amount of SOLs is always associated with the validator.


### Withdrawing Bond Account

When someone chooses to stop participating in covering the bonds for [protected events](https://marinade.finance/blog/introducing-protected-staking-rewards/),
they can withdraw the funds by transferring the ownership of the stake accounts
back to the (original) owner.

This process involves two steps:

1. Initialize a withdrawal request, which means creating an on-chain account (a ticket) informing the protected event system about the intention to withdraw funds.
2. Only after the lockup time elapses (a program configuration property) can one call to claim the withdrawal request and regain ownership of the funds held within the stake account.

**NOTE:** The amount declared in the withdrawal request ticket account is no longer
          considered as part of the funded bond amount.

To initialize the withdrawal request, one needs to define the maximum number of lamports
that are requested to be withdrawn upon claiming.
The amount defined on creating withdraw request can be _bigger_ than amount funded to bond.

**IMPORTANT:** If you want to withdraw all SOLs from the funded bond **ALL**
               as value for `--amount` argument.

For claiming, one may define `--withdrawer` as the public key where the claimed
stake accounts will be assigned (by withdrawer and staker authorities) to.
When not defined, the default wallet keypair address is used (`~/.config/solana/id.json`)
as the new owner of the stake accounts.

```sh
# 1) Initialize withdraw request
validator-bonds -um init-withdraw-request <bond-or-vote-account-address> \
  --authority <bond-authority-keypair> \
  --amount <number-of-requested-lamports-to-be-withdrawn __OR__ "ALL">

# 2) Claim existing withdraw request
validator-bonds -um claim-withdraw-request <withdraw-request-or-bond-account-address> \
  --authority <bond-authority-keypair> \
  --withdrawer <user-pubkey>
```

The meanings of parameters are as follows:

- `<bond-or-vote-account-address>`: bond account from which funds will be withdrawn
- `--stake-account`: address of the stake account that will be assigned under the bonds program
- `--authority`: bond account authority with permission to make changes on the bond account,
  either configured pubkey in the bonds account (see `configure-bond` above) or the validator
  identity
- `--amount`: amount of lamports required to be withdrawn from the bonds program
- `--withdrawer`: new owner of the withdrawn stake accounts

#### Technical details on creating withdraw request and claiming

When creating a withdraw request, a specific number of lamports is designated for withdrawal after the delayed claiming period.
This represents the maximum amount that can be withdrawn once the period elapses.
However, during this time, staking rewards may accrue, resulting in a discrepancy between the requested withdrawal amount
and the actual available lamports in stake accounts.
The system only allows withdrawal of the specified amount in the withdraw request.

At time of withdrawal (`claim-withdraw-request`), one must specify the stake account from which the amount
will be taken. This typically results in __splitting the stake account__,
where one portion of lamports is transferred to the withdrawer,
while the remaining portion is retained in the validator bonds contract.

However, a split stake account issue may arise if the requested withdrawal amount is not conducive to creating viable stake accounts.
A viable stake account requires a defined amount of `1` SOL + rent amount (`~0.002282880` SOL).
Failure to meet this criteria may result in the `claim-withdraw-request` operation failing.
Refer to [FAQ, section Failed to claim withdraw request](#faq-and-issues)
for more information on issues related to failed withdrawal requests.


### Cancelling Withdraw Request Account

The withdrawal request can be cancelled at any time.

If the Bond owner desires to change the withdrawal amount or wishes to return the amount
to be considered as funded bonds again, they need to cancel the existing request
and potentially create a new withdrawal request later on.

```sh
validator-bonds -um cancel-withdraw-request <withdraw-request-or-bond-account-address> \
  --authority <bond-authority-keypair>
```

### Show Validator Bonds Program Configuration

To check the Validator Bonds program configuration data, use the `show-config` command.
The Marinade config account address is `vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU`.

To check the lockup period for the withdraw request ticket, verify the value of
'withdrawLockupEpochs' to find the required number of epochs that must elapse after
the withdrawal request is created.

```sh
validator-bonds -um show-config vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU
```

## Searching Bonds funded stake accounts

Bond program assigns the funded stake accounts with `withdrawal` authority of address
`7cgg6KhPd1G8oaoB48RyPDWu7uZs51jUpDYB3eq4VebH`. To query the all stake accounts
one may use the RPC call of `getProgramAccounts`.

Technical details of the stake account layout can be found in Solana source code [for staker and withdrawer](https://github.com/solana-labs/solana/blob/v1.17.15/sdk/program/src/stake/state.rs#L60)
and for [voter pubkey](https://github.com/solana-labs/solana/blob/v1.17.15/sdk/program/src/stake/state.rs#L414).

```
STAKER_OFFSET = 12 // 4 for enum, 8 rent exempt reserve
WITHDRAWER_OFFSET = 44 // 4 + 8 + staker pubkey
VOTER_PUBKEY_OFFSET = 124 // 4 for enum + 120 for Meta
```

```sh
RPC_URL='https://api.mainnet-beta.solana.com'
curl $RPC_URL -X POST -H "Content-Type: application/json" -d '
  {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getProgramAccounts",
    "params": [
      "Stake11111111111111111111111111111111111111",
      {
        "encoding": "base64",
        "dataSlice": {
            "offset": 0,
            "length": 0
        },
      "filters": [
          {
            "memcmp": {
              "offset": 44,
              "bytes": "7cgg6KhPd1G8oaoB48RyPDWu7uZs51jUpDYB3eq4VebH"
            }
          }
        ]
      }
    ]
  }
' | jq '.'
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

The support for ledger came from [`@marinade.finance/ledger-utils` TS implementation wrapper](https://github.com/marinade-finance/marinade-ts-cli/tree/main/packages/lib/ledger-utils) around `@ledgerhq/hw-app-solana`. The implementation tries to be compatible with way how [`solana` CLI](https://github.com/solana-labs/solana/blob/v1.14.19/clap-utils/src/keypair.rs#L613) behaves.


## NPM packages installation and execution

To verify the installation folders for NPM and to install the package globally,
check the configuration.
The default properties and potentially existing `.npmrc` configuration file can
be checked with the command `npm config list`.

To check where NPM packages are and will be installed:

```sh
# Get npm global installation folder
npm list -g
> /usr/lib
> +-- @marinade.finance/validator-bonds-cli@1.3.6
> ...
# In this case, the `bin` folder is located at /usr/bin
```

To verify the configuration of paths, use:

```sh
npm config get cache
npm config get prefix
```

If there are defined folders accessible only by the `root` account,
configure the user workspace local configuration as follows:

```sh
npm config set cache ~/.cache/npm
npm config set prefix ~/.local/share/npm
```

With this configuration, NPM packages will be installed under the `prefix` directory.

```sh
npm i -g @marinade.finance/validator-bonds-cli@latest
npm list -g
> ~/.local/share/npm/lib
> `-- @marinade.finance/validator-bonds-cli@1.3.6
```

To execute the installed packages from any location,
configure the `PATH` to place the newly defined user workspace local installation before others.

```sh
# the nodejs binaries reside in '~/.local/share/npm/bin' for this particular case
NPM_LIB=`npm list -g | head -n 1`
export PATH=${NPM_LIB/%lib/bin}:$PATH
```

### NPM Exec From Local Directory

One can use the `npm exec` command to install the NPM package into a local folder and execute it from there.

```sh
cd /tmp
npm install @marinade.finance/validator-bonds-cli@latest

# `node_modules` exists in the folder and contains the CLI and its dependencies
ls node_modules
# Execute from the local directory
npm exec -- validator-bonds --version
```

## `validator-bonds CLI Reference`

### `validator-bonds cli --help`
```sh
validator-bonds cli --help
Usage: validator-bonds [options] [command]

Options:
  -V, --version                                   output the version number
  -u, --cluster <cluster>                         solana cluster URL or a moniker (m/mainnet/mainnet-beta, d/devnet, t/testnet, l/localhost) (default: "mainnet")
  -c <cluster>                                    alias for "-u, --cluster"
  -k, --keypair <keypair-or-ledger>               Wallet keypair (path or ledger url in format usb://ledger/[<pubkey>][?key=<derivedPath>]). Wallet keypair is used to pay for the transaction fees and as default
                                                  value for signers. (default: loaded from solana config file or ~/.config/solana/id.json)
  --program-id <pubkey>                           Program id of validator bonds contract (default: vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4)
  -s, --simulate                                  Simulate (default: false)
  -p, --print-only                                Print only mode, no execution, instructions are printed in base64 to output. This can be used for placing the admin commands to SPL Governance UI by hand.
                                                  (default: false)
  --skip-preflight                                Transaction execution flag "skip-preflight", see https://solanacookbook.com/guides/retrying-transactions.html#the-cost-of-skipping-preflight (default: false)
  --commitment <commitment>                       Commitment (default: "confirmed")
  --confirmation-finality <confirmed|finalized>   Confirmation finality of sent transaction. Default is "confirmed" that means for majority of nodes confirms in cluster. "finalized" stands for full cluster
                                                  finality that takes ~8 seconds. (default: "confirmed")
  --with-compute-unit-price <compute-unit-price>  Set compute unit price for transaction, in increments of 0.000001 lamports per compute unit. (default: 10)
  -d, --debug                                     Printing more detailed information of the CLI execution (default: false)
  -v, --verbose                                   alias for --debug (default: false)
  -h, --help                                      display help for command

Commands:
  init-config [options]                           Create a new config account.
  configure-config [options] [address]            Configure existing config account.
  mint-bond [options] <address>                   Mint a Validator Bond token, providing a means to configure the bond account without requiring a direct signature for the on-chain transaction. The workflow is as
                                                  follows: first, use this "mint-bond" to mint a bond token to the validator identity public key. Next, transfer the token to any account desired. Finally, utilize
                                                  the command "configure-bond --with-token" to configure the bond account.
  init-bond [options]                             Create a new bond account.
  configure-bond [options] <address>              Configure existing bond account.
  merge-stake [options]                           Merging stake accounts belonging to validator bonds program.
  fund-bond [options] <address>                   Funding a bond account with amount of SOL within a stake account.
  init-withdraw-request [options] [address]       Initializing withdrawal by creating a request ticket. The withdrawal request ticket is used to indicate a desire to withdraw the specified amount of lamports
                                                  after the lockup period expires.
  cancel-withdraw-request [options] [address]     Cancelling the withdraw request account, which is the withdrawal request ticket, by removing the account from the chain.
  claim-withdraw-request [options] [address]      Claiming an existing withdrawal request for an existing on-chain account, where the lockup period has expired. Withdrawing funds involves transferring ownership
                                                  of a funded stake account to the specified "--withdrawer" public key. To withdraw, the authority signature of the bond account is required, specified by the
                                                  "--authority" parameter (default wallet).
  pause [options] [address]                       Pausing Validator Bond contract for config account
  resume [options] [address]                      Resuming Validator Bond contract for config account
  show-config [options] [address]                 Showing data of config account(s)
  show-event [options] <event-data>               Showing data of anchor event
  show-bond [options] [address]                   Showing data of bond account(s)
  help [command]                                  display help for command
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
  you can run search with CLI `validator-bonds -um show-bond <bond-or-vote-account>`
  to check if account was created.

* **bigint: Failed to load bindings, ...**

  CLI shows error `the bigint: Failed to load bindings, pure JS will be used (try npm run rebuild?)`
  is caused by system configuration requirements from `@solana/web3.js` (details at https://solana.stackexchange.com/questions/4077/bigint-failed-to-load-bindings-pure-js-will-be-used-try-npm-run-rebuild-whe). No functionality issues with this error.

  **Solution:**

  All works fine.

  To get rid of the warning, one can install packages `build-essential python3` and reinstall the cli package.
  Relevant for Ubuntu/Debian systems, for other OS search appropriate packages on your own.
  ```
  apt-get install build-essential python3
  npm i -g @marinade.finance/validator-bonds-cli@latest
  ```
* **npm i -g @marinade.finance/validator-bonds-cli@latest** does not install the latest version

  Regardless the command `npm i -g @marinade.finance/validator-bonds-cli@latest` should install the latest
  CLI version on your system, the `validator-bonds --version` shows outdated version
  that does not match with one listed at NPM registry
  at https://www.npmjs.com/package/@marinade.finance/validator-bonds-cli

  **Investigation:**

  It's possible that there are two `validator-bonds` npm packages installed on your system.
  One may be global (installed from the `root` account), and the other installed from the user workspace.
  The `PATH` configuration may prioritize the global path installed by `root`,
  and any package reinstallation within the user workspace may not make any change.

  To investigate the state of your system, verify the global installation folder with the `npm list -g` command.
  Then, check the location where the `validator-bonds` command is executed from with the `which` command.

  ```sh
  # Get npm global installation folder
  npm list -g
  > ~/.local/share/npm/lib
  > `-- @marinade.finance/validator-bonds-cli@1.3.6
  # In this case, the 'bin' folder is located at ~/.local/share/npm/bin

  # Get validator-bonds binary folder
  which validator-bonds
  > /usr/bin/validator-bonds
  ```

  **Solution:**

  Apply one of the following suggestions:

  * Remove the binary from the location reported by the `which` command, ``sudo rm -f `which validator-bonds` ``
  * Change `PATH` to prioritize the `npm -g` folders, ``NPM_LIB=`npm list -g | head -n 1`; export PATH=${NPM_LIB/%lib/bin}:$PATH``
  * Use local `npm exec` execution instead of global installation, see the section [*NPM Exec From Local Directory*](#npm-exec-from-local-directory)

* **Command yields `The RPC call or parameters have been disabled`**

  The command (most probably `show-` command) finishes with an error:

  ```
  Error: 410 Gone:  {"jsonrpc":"2.0","error":{"code": 410, "message":"The RPC call or parameters have been disabled."}
  ```

  This is caused by the public RPC API endpoint https://api.mainnet-beta.solana.com
  blocks the RPC method [getProgramAccounts](https://solana.com/docs/rpc/http/getprogramaccounts) to prevent overload.
  When the command uses `-um` (i.e., `--url mainnet`) the public RPC API endpoint is used.

  The `show-*` commands sometimes require loading and filtering multiple accounts
  where the `getProgramAccounts` method is needed.

  **Solution:**

  * To retrieve printed data about one particular bond account, this error should not be seen. Use a simple call of `show-bond <vote-account>`
  and **DO NOT** use filter arguments like `show-bond --vote-account <address>`.
  * Use a private RPC endpoint. Most providers offer free plans that can be easily used here. `export RPC_URL=<private-rpc-http-endpoint>; show-bond -u$RPC_URL...`

* **node_modules/@solana/webljs/lib/index.cjs.js:643 keyMeta.isSigner ||= accountMeta.isSigner**

  ```
  SyntaxError: Unexpected token '='
  ```

  This is likely caused by an outdated version of Node.js on the machine.

  **Solution:**

  Upgrade Node.js to version 16 or later.

* **Segmentation fault (core dumped)**

  This could be caused by the system containing two different versions of Node.js,
  one installed at the system level (e.g., via `apt`) and the other installed via `npm`.

  **Solution:**

  Remove Node.js from the system and use the version from `npm`. For `apt`, use the following commands:

  ```sh
  sudo apt remove nodejs
  sudo apt autoremove
  node --version
  ```

* **WithdrawRequestNotReady ... Withdraw request has not elapsed the epoch lockup period yet.**

  ```
  "Program log: AnchorError caused by account: withdraw_request. Error Code: WithdrawRequestNotReady. Error Number: 6021. Error Message: Withdraw request has not elapsed the epoch lockup period yet."
  ```

  **Explanation**
  
  This error occurs with the `claim-withdraw-request` CLI command and means that the withdrawal request is not yet ready.
  The bonds program allows funds to be withdrawn only after a specified time defined in the `Config` account.
  Wait for a few `epochs` for the request to become available for claiming.
  More information can be found in the [Withdrawing Bond Account](#withdrawing-bond-account) section.

* **Error processing Instruction 0: custom program error: 0xbbd**

 ```
 Anchor error 3005 (0xbbd), AccountNotEnoughKeys. Not enough account keys given to the instruction
 ```

 After updating the contract to the audited version, auditors requested using the CPI logging method,
 which causes the old CLI to fail with error `3005 (0xbbd)`.
 This error occurs due to insufficient account keys provided by old version of CLI to the instruction,
 as the [`emit cpi`](https://book.anchor-lang.com/anchor_in_depth/events.html#cpi-events)
 functionality requires specialized PDA at the call.

 **Solution:**

 Update version of CLI to most up-to-date.

 ```
 npm i -g @marinade.finance/validator-bonds-cli@latest
 ```

* **Failed to claim withdraw request ...***

  ```
  custom program error: 0x178f

   "Program log: AnchorError caused by account: stake_account. Error Code: StakeAccountNotBigEnoughToSplit.
   Error Number: 6031. Error Message: Stake account is not big enough to be split.",
        "Program log: Left: stake_account_lamports - amount_to_fulfill_withdraw < minimal_stake_size",
        "Program log: Right: 4030090170 - 4020836040 < 1002282880",
  ```

  See [at technical details on claiming process](#technical-details-on-creating-withdraw-request-and-claiming).

  **Solution:**

  Send `1.002282880` SOLs (usual SOL transfer to stake accoun public key address)
  to the stake account bonded to your bond account.
  This will ensure that the overflow amount available in the stake account is sufficient for splitting.
  Then, you can withdraw the requested SOLs (in this case amount of 4020836040 lamports, i.e., ~ 4 SOLs)
  from the bonds program.
  The rest of `1.002282880` can be withdrawn by cancelling the fulfilled withdraw request
  and creating new withdraw request for the particular amount.

  Or, cancel the current withdraw request and create a new one that will specify large enough `--amount`
  to cover additional staking rewards gained by stake accounts during delayed period until claiming is permitted.
  For example in this the new withdraw request could define `--amount` to be 5 SOLS instead of 4 SOLs,
  or use `--amount ALL` to declare that everything from bond should be withdrawn regardless
  of rewards or whatever.

  Send `1.002282880` SOLs (by usual means of transfer SOL to stake account public key address)
  to the stake account bonded to your bond account. That way the sufficient overflow for splitting is ensured.
  Then, withdraw the requested SOLs (for this particular example it's approximately 4 SOLs, i.e., 4020836040 lamports)
  by use of `claim-withdraw-request` CLI command.
  The remaining `1.002282880` can be withdrawn by canceling the fulfilled withdrawal request
  and then creating a new one for that specific amount (needed to wait until new withdraw request elapses).

  Alternatively, cancel the current withdrawal request and create a new one with a larger `--amount` to cover
  additional staking rewards earned by stake accounts during the delayed period until claiming is permitted.
  For example, the new withdrawal request could specify `--amount` as 5 SOLs instead of 4 SOLs for this particular example,
  or use term `"ALL"` (`--amount ALL`) to declare the desire to withdraw everything from the bond regardless of anything.
