# Validator Bonds Institutional CLI

Institutional CLI for Validator Bonds contract.

## Working with CLI

To install the CLI as global npm package

```sh
npm install -g @marinade.finance/validator-bonds-cli-institutional@latest
```

Successful installation will be shown in similar fashion to this output
(it is recommended to use NodeJS 20+).

```
added 199 packages in 17s

19 packages are looking for funding
  run `npm fund` for details
```

To get info on available commands

```sh
# to verify installed version
validator-bonds-institutional --version
2.2.2

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
# number of SOL is transferred to a stake account that is assigned under Validator Bonds program
validator-bonds-institutional fund-bond-sol <vote-account-address> --from <wallet-keypair> --amount <1 SOL for every 1,000 SOL staked>

# STEP 3: SHOW BOND DATA
RPC_URL=<url-to-solana-rpc-node>
validator-bonds-institutional -u $RPC_URL show-bond <vote-account-address> --with-funding
```

### Creating a bond

Creating a bond means creating an on-chain account.
The bond account is strictly coupled with a vote account.

It can be created in two ways:

- permission-ed: `--validator-identity <keypair-wallet>` signature is needed.
  One may then configure additional authority that permits future changes at the bond account
  with argument `--bond-authority` (the bond authority can be set at this point to anything).
- permission-less: anybody may create the bond account. For any future configuration change
  of bond account, or for withdrawal funds, the validator identity signature is needed(**!**)
  (the bond authority is set to identity of the validator at this point).

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

For technical details on the bond creation process, please refer to the
[`Bond creation details` in the Validator Bonds CLI README](https://github.com/marinade-finance/validator-bonds/blob/main/packages/validator-bonds-cli/README.md#bond-creation-details).

### Permission-ed and Permission-less Bonds Creation and Configuration

When a Bond Account is created in a permission-ed way, it can be configured and withdrawn from by signing
the transaction with either the validator's identity keypair or a keypair specified using the `--bond-authority` flag.

When a Bond Account is created in a permission-less way, it can be configured and withdrawn from by signing
the transaction with the validator's identity keypair or by minting a "configuration token."
This token allows its holder to operate the Bond Account.
The intention behind this is to support cases where a user does not have direct access to the Validator Bonds CLI
or the validator’s identity keypair. In such cases, the user can mint a configuration token in a permission-less manner.
This token is minted exclusively to the validator’s identity public key. The owner of the identity keypair can
then transfer the token to any address (for example, a newly created one).
The owner of that address becomes the effective owner of the Bond Account.

```sh
# minting the validator bonds' configuration token to validator's identity address
validator-bonds-institutional -um mint-bond <bond-or-vote-account-address>

# example on transferring the token to different address (Solana CLI is required)
#  - the recipient keypair is to be used to sign configure-bond instead of identity key
#  - use show-bond command to verify what the configuration token mint for bond is
spl-token transfer -um <token-mint-address> 1 <recipient-wallet-address>

# configure bond to permit configuration and withdrawal to a specific address
#  - here we configure the recipient wallet being the new authority for the bond account
validator-bonds-institutional configure-bond --authority <recipient-wallet-keypair> \
  --with-token --bond-authority <new-bond-authority--recipient-wallet-address> <bond-or-vote-account-address>

```

### Show the bond account

```sh
RPC_URL=<url-to-solana-rpc-node>
validator-bonds-institutional -u$RPC_URL show-bond <bond-or-vote-account-address> --with-funding --verbose
```

For details on meanings of the particular fields in the listing, please refer to
[`Show the bond account` in the Validator Bonds CLI README](https://github.com/marinade-finance/validator-bonds/blob/main/packages/validator-bonds-cli/README.md#show-the-bond-account).

### Funding Bond Account

The bond account exists to be funded to cover rewards distribution.

Funding the bond means underlaying stake account is created.
Such stake account is delegated to the validator vote account
and is still generating staking rewards.

User may either fund bond from a wallet or assigning a stake account under the Bond program.

For more details on the process and restrictions, please refer to
[`Funding Bond Account` in the Validator Bonds CLI README](https://github.com/marinade-finance/validator-bonds/blob/main/packages/validator-bonds-cli/README.md#funding-bond-account).

#### Funding with wallet

```sh
validator-bonds-institutional fund-bond-sol <vote-account-address> \
  --from <wallet-keypair> --amount <1 SOL per 1,000 SOL staked>
```

> **NOTE:** This command is a wrapper that creates and delegates a stake account to the vote account.
> `--amount` is the amount of SOL that will be transferred to the stake account.

#### Funding the stake account

```sh
# Create a random keypair for a stake account to be created and funded to bond
# The Validator Bonds program does not preserve stake account public keys as it merges and splits them
STAKE_ACCOUNT='/tmp/stake-account-keypair.json'
solana-keygen new -o "$STAKE_ACCOUNT"

# Creating a stake account. The SOLs will be funded to the Bond
solana create-stake-account "$STAKE_ACCOUNT" <1 SOL for every 1,000 SOL staked>

# To couple the created stake account with the vote account
# This causes the stake account to be in the Activating state.
solana delegate-stake "$STAKE_ACCOUNT" <vote-account-address>

# Funding Bond by assigning the stake account with the SOL amount in it
validator-bonds-institutional fund-bond <bond-or-vote-account-address> \
  --stake-account "$STAKE_ACCOUNT"
```

### Withdrawing Bond Account

Withdrawing funds from the Bond on-chain program consists of two steps:

1. **Initialize a withdrawal request** — This creates an on-chain account (a _ticket_)
   that informs the Bond program of the intention to withdraw funds.
2. **Claim the withdrawal** — After the lockup period elapses (currently 3 epochs),
   the withdrawal request can be claimed to regain control of the funds.
   Claiming a withdrawal request means reassigning ownership of the stake account(s) to the `--withdrawer`.

> **NOTE:** All funds managed by the Bond on-chain program are SOL deposited into delegated stake accounts.
> The Bond program only interacts with stake accounts and does not hold any funds in a central vault.

> **TIP:** To withdraw all available funds from the Bond program, use the `--amount ALL` flag.

```sh
# 1) Initialize withdraw request
validator-bonds-institutional -um init-withdraw-request <bond-or-vote-account-address> \
  --authority <bond-authority-keypair> \
  --amount <number-of-requested-lamports-to-be-withdrawn __OR__ "ALL">

# 2) Claim existing withdraw request after 3 epochs by assigning ownership of the stake accounts
#    to wallet <user-pubkey>
validator-bonds-institutional -um claim-withdraw-request <withdraw-request-or-bond-or-vote-account-address> \
  --authority <bond-authority-keypair> \
  --withdrawer <user-pubkey>

# 3) OPTIONAL: Transfer funds from the claimed stake account to a wallet
#   - `STAKE_ACCOUNT_ADDRESS` is provided in the output of the `claim-withdraw-request` command
#   - `user-pubkey-keypair` is the keypair of the `--withdrawer <user-pubkey>`
# 3.a) Deactivate the stake transferred out of the Bonds Program
solana deactivate-stake --stake-authority <user-pubkey-keypair> <STAKE_ACCOUNT_ADDRESS>
# 3.b) Withdraw SOLs from the stake account to the user’s wallet of address <user-pubkey>
solana withdraw-stake --withdraw-authority <user-pubkey-keypair> <STAKE_ACCOUNT_ADDRESS> <user-pubkey> <AMOUNT>
```

For technical details on creating withdraw request and claiming, please refer to
[`Technical details on creating withdraw request and claiming` in the Validator Bonds CLI README](https://github.com/marinade-finance/validator-bonds/blob/main/packages/validator-bonds-cli/README.md#technical-details-on-creating-withdraw-request-and-claiming).

## Support for Ledger signing

For details please refer to
[`Support for Ledger signing` in the Validator Bonds CLI README](https://github.com/marinade-finance/validator-bonds/tree/main/packages/validator-bonds-cli#support-for-ledger-signing).

## Details on Bond Processing and Select Programme Calculation

Bond calculation and settlement occur with a one-epoch delay.
Funds are debited at the start of epoch X+1 based on data parsed from the last slot of epoch X.

The Select calculation aggregates all rewards earned by a validator (inflation/voting rewards, MEV rewards, block rewards)
and computes the APY based on the `effective` stake (active + deactivating) delegated to the validator.
The resulting APY is then weighted by the ratio of the Select stake
(stake managed by the [Select staker authority](#on-chain-technical-information)).

The APY is calculated using the formula:

```typescript
APY = ((1 + rewardsPerEpoch / stakedAmount) ^ epochsInYear) - 1
```

The Select program guarantees a maximum yield of 50 basis points (bps) from the validator's APY for the Select stake.
Some of the rewards, as of the APY ratio, is then returned via Bonds claims to Marinade, the operator of the program.

Let’s continue with an example:
Assume the validator’s APY is 11.5%. The validator captures a 50bps share, and Marinade charges a 30bps fee.
This means the overall APY that has to be delivered to stakers is 10.7%, calculated as:

```ts
REWARDS_TO_STAKERS = (11.5 - 0.5 - 0.3)/11.5 * SELECT_REWARDS
                   = 10.7 / 11.5 * SELECT_REWARDS
```

The information about the stake amount is taken from a snapshot of the blockchain
at the last slot of the epoch. MEV and inflation rewards are distributed at the beginning
of the epoch, based on the performance of the previous epoch.
All this information is collected.
If the amount distributed to stakers by the Solana network is less than the calculated `REWARDS_TO_STAKERS`, the difference is deducted from the validator’s bond account.

> NOTE: The ratio of rewards distributed to stakers and assigned to a validator
> is defined by the validator's configured `commission`.

> **IMPORTANT**:
> The Select program allows a validator to earn up to 50bps from rewards generated by the Select stake.
> However, Select **cannot** reclaim any SOL that was already distributed to stakers by the Solana network.
> In practice, this means if the rewards assigned to the validator by Solana are less than
> `0.5% / VALIDATOR_APY% * SELECT_REWARDS`, the validator only keeps the rewards it received.
> It is the validator’s responsibility to configure their commission settings appropriately.
> This becomes especially important once [SIMD-0123](https://github.com/solana-foundation/solana-improvement-documents/pull/123) is implemented by the network.

> **MATHEMATICAL NOTE**:
> Select promises to deliver 50 basis points (bps) of APY rewards to the validator.
> This might be interpreted as receiving exactly 50 bps multiplied by the Marinade Select TVL in year, calculated as:
> `((epoch 1 TVL + epoch 2 TVL + ... + last epoch of the year TVL) / number of epochs per year) * 0.005`.
> However, this is not entirely precise. A small discrepancy arises because rewards are paid out on an epoch-by-epoch basis,
> which slightly reduces the compounding base compared to a theoretical full-year compounding calculation.

### Protected Stake Rewards (PSR) Penalty

Select monitors validator voting performance using earned credits, weighted by stake, and compares it
to the standard network average (i.e., the stake-weighted average of earned credits across all validators).
If a validator experiences prolonged downtime, it must compensate for the lost rewards by paying back the corresponding amount.

### Exiting the Set of Select Validators

Exiting the Select set is **not** a permission-less action and must be coordinated with the Marinade team.

When a validator exits the Select set, it is charged (from its bond) for one epoch of rewards
it would have earned from delegated Select stake.
The _effective stake_—that which yields rewards—is defined as the sum of stake in the `active` and `deactivating` states.

Upon exiting, the system initiates deactivation of the validator’s stake so it can be re-delegated to other validators in the set.
The validator must pay rewards for the `deactivating` stake, calculated using that epoch’s APY.

In the following epoch, the `deactivating` stake transitions to the `deactivated` state by the Solana network,
at which point it can be re-delegated and re-activated. Note that stake in the `activating` state yields no rewards.

### Data endpoints of the Select Program

Validators can verify the charged amounts and funded SOL directly on-chain.

**Options:**

- **Current State:**
  - Use the [CLI show command](#show-the-bond-account) to see the current on-chain Bond state
    > _NOTE:_ data from `show-bond` represents current on-chain data not data used for
    > bonds calculation of particular epoch
  - [Bonds API](https://validator-bonds-api.marinade.finance/bonds/institutional)
    that shows the current state of the Bond accounts. Data is updated once per hour.
- **Historical Data:**
  - Dashboard: [Select Bonds Dashboard](https://select.marinade.finance/).
  - Select API calculation data: [Select API](https://institutional-staking.marinade.finance/docs)
  - Select calculation data: [as JSON files form Google Cloud storage](https://console.cloud.google.com/storage/browser/marinade-institutional-staking-mainnet)
  - Settlement data: [Google Cloud storage](https://console.cloud.google.com/storage/browser/marinade-validator-bonds-mainnet).

For advanced on-chain queries, refer to the [on-chain analysis documentation](../../programs/validator-bonds/ON_CHAIN_ANALYSIS.md).

## On-Chain Technical Information

- On-chain Validator Bonds Program address: `vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4`
- Bonds Select Config address: `VbinSTyUEC8JXtzFteC4ruKSfs6dkQUUcY6wB1oJyjE`
- Native Staking Select Staker authority: `STNi1NHDUi6Hvibvonawgze8fM83PFLeJhuGMEXyGps`
- Validator Bonds Stake Account Withdrawer authority: `8CsAFqTh75jtiYGjTXxCUbWEurQcupNknuYTiaZPhzz3`

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
