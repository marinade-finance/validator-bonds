# Validator Bonds Institutional CLI

Institutional CLI for Validator Bonds contract.

## Working with CLI

To install the CLI as global npm package

```sh
npm install -g @marinade.finance/validator-bonds-cli-institutional@latest
```

Successful installation will be shown in similar fashion to this output
<!-- TODO: update the output when the CLI package is published -->

```
added 165 packages in 35s

17 packages are looking for funding
  run `npm fund` for details
```

To get info on available commands

```sh
# to verify installed version
validator-bonds-institutional --version
2.1.7

# get reference of available commands
validator-bonds-institutional --help
```

**Requirements:** Node.js version 16 or higher.


## Required steps for a validator to be eligible for stake distribution

1. [creating a bond](#creating-a-bond)
2. [funding the bond](#funding-bond-account)
3. [track that the bond is sufficiently funded](#show-the-bond-account)

In terms of CLI commands creating and funding bond contains:

```sh
# STEP 1: INITIALIZE BOND
# initializing the bond account for vote-account
validator-bonds-institutional init-bond --vote-account <vote-account-address> \
  --validator-identity ./validator-identity.json
> Bond account BondAddress... of config VbinSTyUEC8JXtzFteC4ruKSfs6dkQUUcY6wB1oJyjE successfully created

# STEP 2: FUND BOND
# SOL is transferred to a stake account that is assigned under Validator Bonds program
validator-bonds-institutional fund-bond-sol <vote-account-address> --from <wallet-keypair> --amount <1 SOL for every 1,000 SOL staked>

# STEP 3: SHOW BOND DATA
RPC_URL=<url-to-solana-rpc-node>
validator-bonds-institutional -u $RPC_URL show-bond <vote-account-address> --with-funding
```


### Creating a bond

Creating a bond means creating an on-chain account. 
The bond account is strictly coupled with a vote account.

It can be created in two ways:

* permission-ed: `--validator-identity <keypair-wallet>` signature is needed.
  One may then configure additional authority that permits future changes at the bond account
  with argument `--bond-authority` (the bond authority can be set at this point to anything).
* permission-less: anybody may create the bond account. For any future configuration change
  of bond account, or for withdrawal funds, the validator identity signature is needed(**!**)
  (the bond authority is set to identity of the validator at this point).

On the bond account:

* there can be only one bond for a vote account
* every bond is attached to a vote account

```sh
# permission-ed: bond account at mainnet
validator-bonds-institutional -um init-bond -k <fee-payer-keypair> \
  --vote-account <vote-account-pubkey> --validator-identity <validator-identity-keypair> \
  --bond-authority <authority-on-bond-account-pubkey> \
  --rent-payer <rent-payer-account-keypair>

# permission-less: bond account at mainnet
validator-bonds-institutional -um init-bond -k <fee-payer-keypair> \
  --vote-account <vote-account-pubkey> --rent-payer <rent-payer-account-keypair>

# to configure bond account properties
validator-bonds-institutional -um configure-bond --help
```


### Funding Bond Account

The bond account exists to be funded to cover rewards distribution.

Funding the bond means underlaying stake account is created.
Such stake account is delegated to the validator vote account
and is still generating staking rewards.

User may either fund bond from a wallet or assigning a stake account under the Bond program.

#### Funding with wallet

```sh
validator-bonds-institutional fund-bond-sol <vote-account-address> --from <wallet-keypair> --amount <1 SOL for every 1,000 SOL staked>
```

#### Funding the stake account

"Funding the bond" consists of two steps:

1. Charging lamports to a stake account.
2. Assigning ownership of the stake account to the Validator Bonds program using
   the `fund-bond` CLI command.

The funded stake account:

- **Must be delegated** to the vote account belonging to the bond account.
- **Must be activating or activated**.


```sh
# Create a random keypair for a stake account to be created and funded to bond
# The Validator Bonds program does not preserve stake account public keys as it merges and splits them
solana-keygen new -o /tmp/stake-account-keypair.json

# Creating a stake account. The SOLs will be funded to the Bond
solana create-stake-account <stake-account-keypair> <1 SOL for every 1,000 SOL staked>

# To couple the created stake account with the vote account
# This causes the stake account to be in the Activating state.
solana delegate-stake <stake-account-pubkey> <vote-account-address>

# Funding Bond by assigning the stake account with the SOL amount in it
validator-bonds-institutional -um fund-bond <bond-or-vote-account-address> \
  --stake-account <stake-account-address> \
  --stake-authority <withdrawer-stake-account-authority-keypair>
```

The meanings of parameters are as follows:

- `<bond-or-vote-account-address>`: bond account that will be funded by the amount of
  lamports from the stake account.
- `--stake-account`: address of the stake account that will be assigned under the bonds program.
- `--stake-authority`: signature of the stake account authority (probably withdrawer)
  that permits to change the stake account authorities

#### How to add more funds under the bond?

It's as simple as creating a new stake account and funding it into the bond program.
The amounts of SOLs delegated to the same validator are summed together.
The validator bonds program may merge or split the accounts delegated to the same validator.
It's not guaranteed to maintain the same stake accounts in the bond,
but the amount of SOLs is always associated with the validator.

### Show the bond account

```sh
validator-bonds-institutional -um show-bond <bond-or-vote-account-address>
```

To display all details about the Bond use `--with-funding` and `--verbose` parameters.
Gathering all the details require multiple calls to RPC node and does not work
properly with public RPC node (moniker `-um` or `--rpc-url mainnet-beta`).
Use some other RPC node url as described at https://solana.com/rpc.

```sh
RPC_URL=<url-to-solana-rpc-node>
validator-bonds-institutional -u$RPC_URL show-bond <bond-or-vote-account-address> \
  --with-funding --verbose
```

Expected output on created bond is like

```
{
  "programId": "vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4",
  "publicKey": "...",
  "account": {
    "config": "vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU",
    "voteAccount": "...",
    "authority": "..."
  },
  "voteAccount": {
    "nodePubkey": "...",
    "authorizedWithdrawer": "...",
    "commission": 0
  },
  "amountOwned": "10.407 SOLs",
  "amountActive": "10.407 SOLs",
  "numberActiveStakeAccounts": 0,
  "amountAtSettlements": "0 SOL",
  "numberSettlementStakeAccounts": 0,
  "amountToWithdraw": "0 SOL",

  "amountOwned": "10.407 SOLs",
  "amountActive": "10.407 SOLs",
  "numberActiveStakeAccounts": 1,
  "amountAtSettlements": "0 SOLs",
  "numberSettlementStakeAccounts": 1,
  "amountToWithdraw": "0 SOL",
  "withdrawRequest": "<NOT EXISTING>",
  "bondMint": "...",
  "bondFundedStakeAccounts": [
    {...}
  ]
}
```

#### Amount Values and the `amountActive` Field

The `amountActive` field represents the amount of SOL available for funding Settlements and is considered
as funded to the Bond account. It is calculated as:

```
amountActive = amountOwned - amountAtSettlements - amountToWithdraw
```

- **`amountOwned`**: The total amount available at the Bond account.
- **`amountAtSettlements`**: The amount reserved in existing Settlements, waiting to be claimed by stakers.
  If not claimed, this amount is returned to the Bond account and reflected in `amountActive`.
- **`amountToWithdraw`**: The amount the user has requested to withdraw, which is no longer considered
  active for Settlement funding.


#### Stake accounts in Validator Bonds and concept of Settlements

The concept of Bonds revolves around managing stake accounts delegated to validators.
This allows the validator to lock funds under the Validator Bonds Program while still earning inflation rewards.
However, the Validator Bonds Program does not preserve the specific stake accounts (i.e., their public keys)
that were initially funded. Instead, the funding is considered as the total sum of lamports across various stake accounts
assigned by `delegate` to `vote account` connected with the `bond account`.

At the start of the epoch, rewards payment calculation is performed,
and a `Settlement` account is created for the calculated amount.
A Settlement represents a payment event for the delegated SOLs.
The `Settlement` account splits the amount into multiple claimable events
that can be permissionlessly claimed and later withdrawn by owners
of the stake accounts delegated to a particular validator.

When a settlement event occurs, some of the stake accounts funded to the `Bond` may be split,
and a portion of the funds (in the value of the amount) is assigned under the `Settlement`.
After the settlement is closed, any non-claimed lamports remaining in the stake account
are returned to the bond's available resources. As a result, there may be more stake accounts
connected to the bond account than before the Settlement was created.
These stake accounts can later be merged if needed to create a larger, compound amount for future settlement funding.

## On-Chain Technical Information

* On-chain Validator Bonds Program address: `vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4`
* Bonds Select Config address: `VbinSTyUEC8JXtzFteC4ruKSfs6dkQUUcY6wB1oJyjE`
* Native Staking Select Staker authority: `STNi1NHDUi6Hvibvonawgze8fM83PFLeJhuGMEXyGps`
* Validator Bonds Stake Account Withdrawer authority: `8CsAFqTh75jtiYGjTXxCUbWEurQcupNknuYTiaZPhzz3`

## Validator Bonds Institutional CLI Reference

### `validator-bonds-institutional --help`
```sh
validator-bonds-institutional --help
Usage: validator-bonds-institutional [options] [command]

Options:
  -V, --version                                   output the version number
  -u, --url <rpc-url>                             solana RPC URL or a moniker (m/mainnet/mainnet-beta, d/devnet, t/testnet, l/localhost), see https://solana.com/rpc (default: "mainnet", env: RPC_URL)
  -c, --cluster <cluster>                         alias for "-u, --url"
  -k, --keypair <keypair-or-ledger>               Wallet keypair (path or ledger url in format usb://ledger/[<pubkey>][?key=<derivedPath>]). Wallet keypair is used to pay for the transaction fees and as default value for signers. (default: loaded from solana
                                                  config file or ~/.config/solana/id.json)
  -s, --simulate                                  Simulate (default: false)
  -p, --print-only                                Print only mode, no execution, instructions are printed in base64 to output. This can be used for placing the admin commands to SPL Governance UI by hand. (default: false)
  --skip-preflight                                Transaction execution flag "skip-preflight", see https://solanacookbook.com/guides/retrying-transactions.html#the-cost-of-skipping-preflight (default: false)
  --commitment <commitment>                       Commitment (default: "confirmed")
  --confirmation-finality <confirmed|finalized>   Confirmation finality of sent transaction. Default is "confirmed" that means for majority of nodes confirms in cluster. "finalized" stands for full cluster finality that takes ~8 seconds. (default: "confirmed")
  --with-compute-unit-price <compute-unit-price>  Set compute unit price for transaction, in increments of 0.000001 lamports per compute unit. (default: 10)
  -d, --debug                                     Printing more detailed information of the CLI execution (default: false)
  -v, --verbose                                   alias for --debug (default: false)
  -h, --help                                      display help for command

Commands:
  bond-address <address>                          From provided vote account address derives the bond account address
  show-bond [options] [address]                   Showing data of bond account(s)
  init-bond [options]                             Create a new bond account.
  configure-bond [options] <address>              Configure existing bond account.
  fund-bond [options] <address>                   Funding a bond account with amount of SOL within a stake account.
  fund-bond-sol [options] <address>               Funding a bond account with amount of SOL. The command creates a stake account, transfers SOLs to it and delegates it to bond.
  mint-bond [options] <address>                   Mint a Validator Bond token, providing a means to configure the bond account without requiring a direct signature for the on-chain transaction. The workflow is as follows: first, use this "mint-bond" to mint a
                                                  bond token to the validator identity public key. Next, transfer the token to any account desired. Finally, utilize the command "configure-bond --with-token" to configure the bond account.
  init-withdraw-request [options] [address]       Initializing withdrawal by creating a request ticket. The withdrawal request ticket is used to indicate a desire to withdraw the specified amount of lamports after the lockup period expires.
  claim-withdraw-request [options] [address]      Claiming an existing withdrawal request for an existing on-chain account, where the lockup period has expired. Withdrawing funds involves transferring ownership of a funded stake account to the specified
                                                  "--withdrawer" public key. To withdraw, the authority signature of the bond account is required, specified by the "--authority" parameter (default wallet).
  cancel-withdraw-request [options] [address]     Cancelling the withdraw request account, which is the withdrawal request ticket, by removing the account from the chain.
  help [command]                                  display help for command
```
