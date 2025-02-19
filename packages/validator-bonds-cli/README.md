# Validator Bonds CLI

CLI for Validator Bonds contract.

## Working with CLI

To install the CLI as global npm package

```sh
npm install -g @marinade.finance/validator-bonds-cli@latest
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
2.1.3
```

To get info on available commands

```sh
validator-bonds --help
```

**Requirements:** Node.js version 16 or higher.

## Required steps for a validator to be eligible for stake distribution

* [creating a bond](#creating-a-bond)
* [funding the bond](#funding-bond-account)
* [bidding for the stake](#bond-account-configuration)
* [track that the bond is sufficiently funded](#show-the-bond-account)


In terms of CLI commands in the most simplistic way:

```sh
# STEP 1: INITIALIZE BOND
# initializing the bond account for vote-account
validator-bonds init-bond --vote-account <vote-account-address> \
  --validator-identity ./validator-identity.json
> Bond account BondAddress9iRYo3ZEK6dpmm9jYWX3Kb63Ed7RAFfUc of config vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4 successfully created

# STEP 2: FUND BOND
# ---
# OPTION A STEP 2: Funding from a wallet
# In background SOL is transferred to a stake account that is assigned under Validator Bonds program
validator-bonds fund-bond-sol <vote-account-address> --from <wallet-keypair> --amount <Amount of SOL
# ---
# OPTION B STEP 2: Funding with a stake account
# Create a random keypair for a stake account to be created and funded to bond
# The Validator Bonds program does not preserve stake account public keys as it merges and splits them
solana-keygen new -o /tmp/stake-account-keypair.json
# Creating a stake account. The SOLs will be funded to the Bond
solana create-stake-account <stake-account-keypair> <Amount of SOL 1 for every 10,000 staked>
# To couple the created stake account with the vote account
# This causes the stake account to be in the Activating state.
solana delegate-stake <stake-account-pubkey> <vote-account-address>
# Funding Bond by assigning the stake account with the SOL amount in it
validator-bonds fund-bond <vote-account-address> --stake-account <stake-account-pubkey>

# STEP 3: PARTICIPATE IN AUCTION
# validator needs to participate in bidding to get the stake
# --cpmpe defines how many lamports the validator is willing to pay for every 1000 SOLs delegated
validator-bonds configure-bond <vote-account-address> --authority ./validator-identity.json --cpmpe <lamports>
> Bond account BondAddress9iRYo3ZEK6dpmm9jYWX3Kb63Ed7RAFfUc successfully configured

# VERIFICATION
# Check the new configuration
validator-bonds show-bond <vote-account-address>
# Track the funding
RPC_URL=<url-to-solana-rpc-node>
validator-bonds -u $RPC_URL show-bond <vote-account-address> --with-funding
```


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

The `init-bond` command initiates the creation of an account on the blockchain containing configuration data specific to a particular bond.
This bond account is intricately linked with a corresponding vote account.
The creation of a bond account requires a validator's identity signature, specifically one associated with the vote account.

The parameters and their meanings are explained in detail below:

* `--k <fee-payer-keypair>:` This parameter designates the account used to cover transaction costs (e.g., `5000` lamports).
* `--vote-account`: Specifies the vote account on which the bond will be established.
* `--validator-identity`: Represents the required signature; the validator identity must match one within the designated vote account.
* `--bond-authority`: Refers to any public key with ownership rights. It is recommended to use a ledger or multisig.
  This key does not necessarily need to correspond to an existing on-chain account (SOL preloading is unnecessary).
* `--rent-payer`: This account covers the creation cost of the Solana bond account, and it is expected to be the same as the fee payer (default).
   The rent cost is `0.00270048` SOL. Note that the `--rent-payer` is unrelated to bond security or "funding," which is addressed through a separate instruction.
   The bond's security is established by providing a stake account. The lamports in the stake account then corresponds to the SOL amount added to the security of the bond account.
   There is no direct payment of SOLs to the bond; it is accomplished solely by allocating stake accounts.
* `--cpmpe`: Cost per mille per epoch, in lamports. How many lamports the validator is willing to pay for every 1000 SOLs delegated.
  The property configures the bid the `Bond` owner wishes to pay for receiving delegated stake. The maximum delegated stake is defined as a percent of full Marinade TVL.
  The percentage is configured within project [ds-sam-pipeline](https://github.com/marinade-finance/ds-sam-pipeline/)
  in [the config as `maxMarinadeTvlSharePerValidatorDec`](https://github.com/marinade-finance/ds-sam-pipeline/blob/main/auction-config.json).
  The actual amount of delegated stake is defined by the [delegation strategy](https://docs.marinade.finance/marinade-protocol/validators).
  The `cpmpe` value goes into the auction where compared with other bids the delegation strategy determines
  the actual amount of stake delegated to the vote account linked to the `Bond` account.
* The funded bond is charged only for the amount of stake that was actually delegated
  (if nothing is delegated, nothing is charged).

### Show the bond account

```sh
validator-bonds -um show-bond <bond-or-vote-account-address>
```

To display all details about the Bond use `--with-funding` and `--verbose` parameters.
Gathering all the details require multiple calls to RPC node and does not work
properly with public RPC node (moniker `-um` or `--rpc-url mainnet-beta`).
Use some other RPC node url as described at https://solana.com/rpc.

```sh
RPC_URL=<url-to-solana-rpc-node>
validator-bonds -u$RPC_URL show-bond <bond-or-vote-account-address> --with-funding --verbose
```

Expected output on created bond is like

```json
{
  "programId": "vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4",
  "publicKey": "...",
  "account": {
    "config": "vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU",
    "voteAccount": "...",
    "authority": "...",
    "costPerMillePerEpoch": "1000 lamports"
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
  "withdrawRequest": "<NOT EXISTING>"
}
```

_NOTE:_ for more details on `429 Too Many Requests` check the section
        [Troubleshooting](#troubleshooting)

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

When a user decides to [withdraw from their Bond account](#withdrawing-bond-account), a special on-chain withdrawal request
is created. This request acts as a ticket authorizing withdrawal after a delay (~4 epochs).
The delay allows the Validator Bonds system time to rebalance the delegated stake if necessary.

The requested withdrawal amount (`amountToWithdraw`) remains available in the Bond but is excluded from `amountActive`
since it is set to be withdrawn.

When creating a withdrawal request with the [`ALL` option](#withdraw-all)
in the [`init-withdraw-request` CLI command](#withdrawing-bond-account), the system interprets it as a request
to withdraw all funds from the Bond account. This may result in `amountActive` becoming negative.

Example of a negative `amountActive`:
```json
"amountActive": "-18446744053.751394957 SOL"
```

This indicates that the user funded their Bond but then created a withdrawal request for `ALL`.
The system calculates `ALL` as an extremely large value
(approximately [`18e18`](https://doc.rust-lang.org/std/u64/constant.MAX.html)).
Subtracting this from the available amount results in a negative `amountActive`,
signifying that no funds are available for Settlement funding.


### Bond account configuration

The `Bond` owner may configure following properties of the account:

* `--bond-authority`: The authority that, when signing the configuration transaction,
  allows changes to the `Bond` account configuration and withdrawal of funds.
  The validator identity keypair of the linked `vote account` or the owner of the
  [SPL minted configuration token](#permission-less-mint---configure-workflow) also has this ability.
* `--cpmpe`: Cost per mille per epoch (in lamports). It's a bid used in the delegation strategy
  auction. The Bond owner agrees to pay this amount in lamports to get stake delegated to the vote
  account for one epoch.


#### Permission-ed Configure workflow

When creating the bond account in a permission-ed manner (as described in [section Creating a Bond](#creating-a-bond)), the authority is defined upfront. This authority is then used
for changing `Bond` account configuration.
(_If one prefers not to sign the CLI transaction with the validator `identity key`, they can utilize the [*mint-configure*](#permission-less-mint---configure-workflow) workflow._)

When `authority` is configure then use

```sh
validator-bonds -um configure-bond <bond-or-vote-account-address> \
  --authority <authority-or-validator-identity.keypair> \
  --bond-authority <new-bond-authority-pubkey>
```

#### Permission-less Mint - Configure workflow

**An alternative step**, the permission-less mint workflow is available only for special
purposes. For configuration, it is typically recommended to use the validator identity
signature, as described in [permission-ed configure workflow](#permission-ed-configure-workflow).

The owner of the `validator identity` key has permission to configure the bond account. To verify the ownership of the validator identity key without requiring the CLI-generated transaction signature and sending it on-chain, one can use Bond's token minting. Use the command `mint-bond`:

```sh
validator-bonds -um mint-bond <bond-or-vote-account-address>
```

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

**! NEVER fund a bond with a direct SOL transfer. The actual Bond funding always happens by assigning a stake account to the `Bond`.**

**! NEVER fund a bond by manually assigning the [withdraw authority](https://solana.com/docs/economics/staking/stake-accounts#understanding-account-authorities) under the Bond PDA. Funding a `Bond` should be done using the [`fund_bond`](https://github.com/marinade-finance/validator-bonds/blob/main/programs/validator-bonds/src/instructions/bond/fund_bond.rs#L13) instruction.**

The bond account exists to be funded, where the funds may be used to cover payments for bidding in auctions
and for a protected event (when a validator under-performs or experiences a serious issue).

#### Funding with wallet

```sh
validator-bonds fund-bond-sol <vote-account-address> --from <wallet-keypair> --amount <Amount of SOL>
```

#### Funding the stake account

"Funding the bond" consists of two steps:

1. Charging lamports to a stake account.
2. Assigning ownership of the stake account to the Validator Bonds program using
   the `fund-bond` CLI command.

The funded stake account:

- **Must be delegated** to the vote account belonging to the bond account.
- **Must be activating or activated**.

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
- `--stake-authority`: signature of the stake account authority (probably withdrawer)
  that permits to change the stake account authorities

#### How to add more funds under the bond?

It's as simple as creating a new stake account and funding it into the bond program.
The amounts of SOLs delegated to the same validator are summed together.
The validator bonds program may merge or split the accounts delegated to the same validator.
It's not guaranteed to maintain the same stake accounts in the bond,
but the amount of SOLs is always associated with the validator.

#### Validator Bonds and funding with stake accounts

The concept of Bonds revolves around managing stake accounts delegated to validators.
This allows the validator to lock funds under the Validator Bonds Program while still
earning inflation rewards. However, Validator Bonds Program is not designed to preserve
the specific stake accounts (i.e, its public keys) that were initially funded.
Instead, the funding is considered as the total sum of lamports across various stake accounts.

When a settlement event occurs, the funded stake account is split,
and a portion of the funds is used for the `Settlement`.
After the settlement is closed, any non-claimed lamports remaining in the stake account are
returned to the bond's available resources, making them eligible for withdrawal.
As a result, there are now two stake accounts.
These stake accounts can later be merged if needed to create a larger,
compound amount for future settlement funding.


### Withdrawing Bond Account

When someone chooses to stop participating in covering the bonds for
[protected events](https://marinade.finance/blog/introducing-protected-staking-rewards/),
they can withdraw the funds **by transferring ownership** of the stake accounts back to
the original owner (i.e., stake account authorities are transferred to `--withdrawer`).

This process involves two steps:

1. Initialize a withdrawal request, which means creating an on-chain account (a ticket) informing the protected event system about the intention to withdraw funds.
2. Only after the lockup period elapses — currently after 3 epochs — can one claim the withdrawal request and regain ownership of the funds.
   Claiming withdrawal request is assigning ownership of stake account(s) to `--withdrawer`.

<a id='withdraw-all'></a>

**IMPORTANT:** If you want to withdraw all SOLs from the funded bond,
               use **ALL** as value for `--amount` argument.
               Using **ALL** means creating a withdrawal request ticket with an amount approximately equal to [`18e18`](https://doc.rust-lang.org/std/u64/constant.MAX.html).

**WARNING:** The amount specified in the withdrawal request ticket account is no longer
             counted as part of the funded bond amount.
             When participating in bond auctions,
             always verify the active stake recognized by the system using the `show-bond` CLI command.

**NOTE:** The withdrawal request account remains on-chain until canceled.
          See details and consequences in the section [Cancelling Withdraw Request](#cancelling-withdraw-request-account).

To initialize the withdrawal request, one needs to define the maximum number of lamports
that are requested to be withdrawn upon claiming.
The amount defined on creating withdraw request can be _bigger_ than amount funded to bond.

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
validator-bonds -um claim-withdraw-request <withdraw-request-or-bond-or-vote-account-address> \
  --authority <bond-authority-keypair> \
  --withdrawer <user-pubkey>


# 3) OPTIONAL: Transfer funds from the claimed stake account to a wallet
#   - `STAKE_ACCOUNT_ADDRESS` is provided in the output of the `claim-withdraw-request` command
#   - `USER_KEYPAIR` is the keypair of the `--withdrawer <user-pubkey>`
# 3.a) Deactivate the stake transferred out of the Bonds Program
solana deactivate-stake --stake-authority <USER_KEYPAIR> <STAKE_ACCOUNT_ADDRESS> \
    --fee-payer <KEYPAIR>
# 3.b) Withdraw the stake to the user’s wallet
solana withdraw-stake --withdraw-authority <USER_KEYPAIR> <STAKE_ACCOUNT_ADDRESS> \
    <user-pubkey> <AMOUNT> --fee-payer <KEYPAIR>
```

The meanings of parameters are as follows:

- `<bond-or-vote-account-address>`: The bond account from which funds
  (i.e., where stake accounts are withdrawn) will be taken.
- `--authority`: The bond account authority with permission to make changes to the bond account.
  This can be either the configured public key in the bond account
  (see `configure-bond` above) or the validator identity.
- `--amount`: The max amount of lamports to be later withdrawn from the bonds program on claiming.
  The amount can only be specified when creating the withdrawal request.
  If a different amount needs to be withdrawn, the old request must be canceled,
  a new withdrawal request with the desired amount must be created
  and you must wait for a few epochs (by default, 3 epochs) before claiming is possible.
- `--withdrawer`: The new owner of the withdrawn stake accounts
  (the `staker` and `withdrawer` authorities are assigned to `--withdrawer` public key).


#### Technical details on creating withdraw request and claiming

When creating a withdrawal request, a specific number of lamports is designated for withdrawal after the delayed claiming period (3 epochs).
This represents the maximum amount that can be withdrawn.
However, during the delayed claiming period, staking rewards may accrue,
resulting in a discrepancy between the requested withdrawal amount
and the actual available lamports in the stake accounts.
The system only allows withdrawal of the specified amount in the withdrawal request.

At time of withdrawal (`claim-withdraw-request`), one must specify the stake account from which the amount
will be taken. This typically results in __splitting the stake account__,
where one portion of lamports is transferred to the withdrawer,
while the remaining portion is retained in the validator bonds contract.

However, a split stake account issue may arise if the requested withdrawal amount is not conducive
to creating viable _delegated_ stake accounts.

A viable stake account must include an amount to cover the rent deposit (`~0.002282880` SOL
for a stake account). The rent is not part of the delegated amount but is a base requirement
for any account created on Solana.
Additionally, a viable _delegated_ stake account must have some SOL beyond the rent deposit.
Currently, Solana requires a minimum of `1 lamport` for this purpose, but this
[requirement may change in the future](https://github.com/solana-labs/solana/issues/24357).

The contract mirrors this requirement by defining the `Config` parameter
[`minimum_stake_lamports`](https://github.com/marinade-finance/validator-bonds/blob/contract-v2.0.0/programs/validator-bonds/src/state/config.rs#L19),
which enforces a minimum amount for each stake account,
ensuring that this amount is locked within any stake account.
This is particularly important for stake accounts funded into a `Settlement`,
as such stake account locks this amount until the `Settlement` is closed and reset.

Failure to meet the minimum stake account size may result in the `claim-withdraw-request` operation failing.
For more details on withdrawal issues, refer to the
[FAQ section on failed withdrawal requests](#faq-and-issues).

### Cancelling Withdraw Request Account

The withdrawal request can be cancelled at any time.

```sh
validator-bonds -um cancel-withdraw-request <withdraw-request-or-bond-account-address> \
  --authority <bond-authority-keypair>
```

The intention [to withdraw funds from the bond account](#withdrawing-bond-account)
is signaled by creating an on-chain withdrawal request account.
This account remains until it is manually canceled.
Only one withdrawal request can exist per bond at a time.

If the bond owner wishes to change the withdrawal amount or have the amount considered
as part of the funded bond again, they must cancel the existing request
and create [a new withdrawal request](#withdrawing-bond-account) if needed.

**NOTE:** When the owner uses `--amount ALL` during withdrawal, the system sets the amount
          to the maximum possible value. Any future bond funding will also be considered as
          withdrawable and thus not counted to bond funded amount.
          The existence of a withdrawal request can be verified using
          the `show-bond` command.

### Show Validator Bonds Program Configuration

The global configuration for the Validator Bonds Program is stored on-chain in
[a config account](https://github.com/marinade-finance/validator-bonds/blob/main/programs/validator-bonds/src/state/config.rs),
which can be viewed using the `show-config` command.
The address of the Marinade config account is `vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU`.

Configuration parameters:

* `epochsToClaimSettlement`: Number of epochs during which a `Settlement` is available for claiming after its creation.
* `slotsToStartSettlementClaiming`: Number of slots that must elapse after a `Settlement` is created before claiming is permitted.
* `withdrawLockupEpochs`: Number of epochs that must elapse before a Bonds withdrawal request can be claimed.
* `minimumStakeLamports`: Minimum size of a stake account when working with split stakes.
* `minBondMaxStakeWanted`: Minimal value in lamports to be permitted being defined for bond.

```sh
# Global configuration of Marinade Validator Bonds Program
validator-bonds -um show-config vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU
```

## Details on Bond Processing

Bond calculation and settlement occur with a one-epoch delay.
Funds are charged at the start of epoch X+1 based on data from epoch X.

### Auction

The auction for epoch X determines the effective bid (`auctionEffectiveBidPmpe`)
for each validator for that epoch.
This value, calculated from bids across participating validators,
defines the SOL cost per 10,000 SOL staked.

**Example:**
If `auctionEffectiveBidPmpe` = `0.123` and a validator is delegated 100K SOL by Marinade,
the payment is:
`0.123 * 100,000 / 10,000 = 1.23 SOL`.

**Access Data:**
  - The results of the auction are stored within the pipeline results
https://github.com/marinade-finance/ds-sam-pipeline/tree/main/auctions
(see the JSON file `<epoch>/outputs/results.json`)
  - The data are loaded to API and are available at
https://scoring.marinade.finance/api/v1/scores/sam?epoch=X
  - The data is displayed at dashboard https://psr.marinade.finance/

#### Settlement Creation

Using delegated stake and auction results from epoch X, Bonds processing creates on-chain
`Settlement` data at the start of epoch X+1. These are funded from the validator's Bond
based on the auction outcome.
The processing runs at the start of epoch X+1 for epoch X, as it is only then clear how many
SOLs Marinade delegated to each validator. The data is sourced from the Solana snapshot
taken at the end of epoch X.

Settlements can be claimed by stakers for 4 epochs.
Unclaimed funds are returned to the validator's Bond.

- **Access Data:**
  - Discord: [PSR feed channel](https://discord.com/channels/823564092379627520/1223330302890348754).
  - Historical data: [Google Cloud storage](https://console.cloud.google.com/storage/browser/marinade-validator-bonds-mainnet).

### PSR Events

Bonds can also be charged for [PSR events](https://marinade.finance/how-it-works/psr).

**Note:**
The term "uptime" refers to "voting uptime," i.e., the number of
[vote credits](https://docs.anza.xyz/proposals/timely-vote-credits) earned.
Bond calculations ensure validators earn inflation rewards equal to or above the network average.
Validators below the standard are charged to cover the shortfall,
and a Settlement is created for this purpose.

### Verifying Charged Amounts

Validators can verify charged amounts and funded SOLs on-chain.

**Options:**
- **Current State:** Use the [CLI show command](#show-the-bond-account) to see the current on-chain Bond state
  - _NOTE:_ data from `show-bond` represents current on-chain data not data used
        for bonds calculation of particular epoch
- **Historical Data:**
  - Dashboard: [PSR Bonds Dashboard](https://psr.marinade.finance/).
  - Auction data: [Auction scores API](https://scoring.marinade.finance/api/v1/scores/sam?epoch=X).
  - Settlement data: [Google Cloud storage](https://console.cloud.google.com/storage/browser/marinade-validator-bonds-mainnet).

For advanced on-chain queries, refer to the [on-chain analysis documentation](../../programs/validator-bonds/ON_CHAIN_ANALYSIS.md).


## Searching Bonds funded stake accounts

Bond program assigns the funded stake accounts with `withdrawal` authority of address
`7cgg6KhPd1G8oaoB48RyPDWu7uZs51jUpDYB3eq4VebH`.

Technical details of the stake account layout can be found in Solana source code [for staker and withdrawer](https://github.com/solana-labs/solana/blob/v1.17.15/sdk/program/src/stake/state.rs#L60)
and for [voter pubkey](https://github.com/solana-labs/solana/blob/v1.17.15/sdk/program/src/stake/state.rs#L414).

To query all the stake accounts
one may use the RPC call of `getProgramAccounts`.

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

To query by parameters one needs to add an offset of the data.
For all stake accounts assigned under Bond and delegated to a validator
one uses voter key.

```
STAKER_OFFSET = 12 // 4 for enum, 8 rent exempt reserve
WITHDRAWER_OFFSET = 44 // 4 + 8 + staker pubkey
// to whom the stake is delegated
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
          },
          {
            "memcmp": {
              "offset": 124,
              "bytes": "<<vote account address>>"
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
> +-- @marinade.finance/validator-bonds-cli@2.1.3
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
> `-- @marinade.finance/validator-bonds-cli@2.1.3
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

## `Validator Bonds CLI Reference`

### `validator-bonds --help`
```sh
validator-bonds --help
Usage: validator-bonds [options] [command]

Options:
  -V, --version                                   output the version number
  -u, --url <rpc-url>                             solana RPC URL or a moniker (m/mainnet/mainnet-beta, d/devnet, t/testnet, l/localhost), see https://solana.com/rpc (default: "mainnet")
  -c, --cluster <cluster>                         alias for "-u, --url"
  -k, --keypair <keypair-or-ledger>               Wallet keypair (path or ledger url in format usb://ledger/[<pubkey>][?key=<derivedPath>]). Wallet keypair is used to pay for the transaction fees
                                                  and as default value for signers. (default: loaded from solana config file or ~/.config/solana/id.json)
  --program-id <pubkey>                           Program id of validator bonds contract (default: vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4)
  -s, --simulate                                  Simulate (default: false)
  -p, --print-only                                Print only mode, no execution, instructions are printed in base64 to output. This can be used for placing the admin commands to SPL Governance UI
                                                  by hand. (default: false)
  --skip-preflight                                Transaction execution flag "skip-preflight", see https://solanacookbook.com/guides/retrying-transactions.html#the-cost-of-skipping-preflight
                                                  (default: false)
  --commitment <commitment>                       Commitment (default: "confirmed")
  --confirmation-finality <confirmed|finalized>   Confirmation finality of sent transaction. Default is "confirmed" that means for majority of nodes confirms in cluster. "finalized" stands for
                                                  full cluster finality that takes ~8 seconds. (default: "confirmed")
  --with-compute-unit-price <compute-unit-price>  Set compute unit price for transaction, in increments of 0.000001 lamports per compute unit. (default: 10)
  -d, --debug                                     Printing more detailed information of the CLI execution (default: false)
  -v, --verbose                                   alias for --debug (default: false)
  -h, --help                                      display help for command

Commands:
  init-config [options]                           Create a new config account.
  configure-config [options] [address]            Configure existing config account.
  mint-bond [options] <address>                   Mint a Validator Bond token, providing a means to configure the bond account without requiring a direct signature for the on-chain transaction.
                                                  The workflow is as follows: first, use this "mint-bond" to mint a bond token to the validator identity public key. Next, transfer the token to any
                                                  account desired. Finally, utilize the command "configure-bond --with-token" to configure the bond account.
  init-bond [options]                             Create a new bond account.
  configure-bond [options] <address>              Configure existing bond account.
  merge-stake [options]                           Merging stake accounts belonging to validator bonds program.
  fund-bond [options] <address>                   Funding a bond account with amount of SOL within a stake account.
  fund-bond-sol [options] <address>               Funding a bond account with amount of SOL. The command creates a stake account, transfers SOLs to it and delegates it to bond.
  init-withdraw-request [options] [address]       Initializing withdrawal by creating a request ticket. The withdrawal request ticket is used to indicate a desire to withdraw the specified amount of lamports after the lockup period expires.
  cancel-withdraw-request [options] [address]     Cancelling the withdraw request account, which is the withdrawal request ticket, by removing the account from the chain.
  claim-withdraw-request [options] [address]      Claiming an existing withdrawal request for an existing on-chain account, where the lockup period has expired. Withdrawing funds involves
                                                  transferring ownership of a funded stake account to the specified "--withdrawer" public key. To withdraw, the authority signature of the bond
                                                  account is required, specified by the "--authority" parameter (default wallet).
  pause [options] [address]                       Pausing Validator Bond contract for config account
  resume [options] [address]                      Resuming Validator Bond contract for config account
  show-config [options] [address]                 Showing data of config account(s)
  show-event [options] <event-data>               Showing data of anchor event
  show-bond [options] [address]                   Showing data of bond account(s)
  show-settlement [options] [address]             Showing data of settlement account(s)
  bond-address [options] <address>                From provided vote account address derives the bond account address
  help [command]                                  display help for command
```

## Troubleshooting

* Verify using the latest available version: https://www.npmjs.com/package/@marinade.finance/validator-bonds-cli
* Try running with `--verbose` to get more details on the CLI run

## FAQ and issues

* **npm WARN EBADENGINE Unsupported engine {**<a id='troubleshooting-npm-ebadengine'></a>

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

* **ExecutionError: Transaction XYZ not found**<a id='troubleshooting-execution-error'></a>

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

* **bigint: Failed to load bindings, ...**<a id='troubleshooting-bigint-bindings'></a>

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
* **npm i -g @marinade.finance/validator-bonds-cli@latest**<a id='troubleshooting-latest-version'></a>
  does not install the latest version

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
  > `-- @marinade.finance/validator-bonds-cli@2.1.3
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

* **Command yields `The RPC call or parameters have been disabled`**<a id='troubleshooting-rpc-disabled'></a>

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

  * To retrieve printed data about one particular bond account, this error should not be seen.
    Use a simple call of `show-bond <vote-account>`
    and **DO NOT** use filter arguments like `show-bond --vote-account <address>`.
  * Use a private RPC endpoint (see https://solana.com/rpc). Most providers offer free plans
    that can be easily used: `RPC_URL=<private-rpc-http-endpoint>; show-bond -u$RPC_URL...`

* **command fails with `429 Too Many Requests`**<a id='troubleshooting-too-many-requests'></a>

  This error often occurs when the `show-bond` command is used with the public RPC API endpoint
  `https://api.mainnet-beta.solana.com`, which is the default endpoint for CLI commands.
  To display all the details, the CLI often needs to execute multiple RPC queries.
  Public RPC nodes impose rate limits, and exceeding these limits results in the
  `429 Too Many Requests` error.

  **Solution:**

  * Use a private RPC endpoint (see https://solana.com/rpc).
    Most providers offer free plans that can be easily utilized:
    `RPC_URL=<private-rpc-http-endpoint>; show-bond -u $RPC_URL...`

* **node_modules/@solana/webljs/lib/index.cjs.js:643 keyMeta.isSigner ||= accountMeta.isSigner**
  <a id='troubleshooting-account-meta-signer'></a>

  ```
  SyntaxError: Unexpected token '='
  ```

  This is likely caused by an outdated version of Node.js on the machine.

  **Solution:**

  Upgrade Node.js to version 16 or later.

* **Segmentation fault (core dumped)**<a id='troubleshooting-segmentation-fault'></a>

  This could be caused by the system containing two different versions of Node.js,
  one installed at the system level (e.g., via `apt`) and the other installed via `npm`.

  **Solution:**

  Remove Node.js from the system and use the version from `npm`. For `apt`, use the following commands:

  ```sh
  sudo apt remove nodejs
  sudo apt autoremove
  node --version
  ```

* **DeprecationWarning: The punycode module is deprecated. Please use a userland alternative instead.**
  <a id='troubleshooting-deprecation-punycode'></a>

  **Explanation**

  This is an issue with the core Typescript dependency solana-web3.js (https://github.com/solana-labs/solana-web3.js/issues/2781).
  The CLI is awaiting the official release of a new major version of the web3.js
  library that fixes this flaw.

  **Solution**

  No functionality issue. The CLI can be used as is with this warning displayed.

* **WithdrawRequestNotReady ... Withdraw request has not elapsed the epoch lockup period yet.**
  <a id='troubleshooting-withdraw-not-ready'></a>

  ```
  "Program log: AnchorError caused by account: withdraw_request. Error Code: WithdrawRequestNotReady. Error Number: 6021. Error Message: Withdraw request has not elapsed the epoch lockup period yet."
  ```

  **Explanation**

  This error occurs with the `claim-withdraw-request` CLI command and means that the withdrawal request is not yet ready.
  The bonds program allows funds to be withdrawn only after a specified time defined in the `Config` account.
  Wait for a few `epochs` for the request to become available for claiming.
  More information can be found in the [Withdrawing Bond Account](#withdrawing-bond-account) section.

* **Error processing Instruction 0: custom program error: 0xbbd**
  <a id='troubleshooting-custom-error-0xbbd'></a>

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
  <a id='troubleshooting-failed-to-claim'></a>

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
  The remaining `1.002282880` can be withdrawn by cancelling the fulfilled withdrawal request
  and then creating a new one for that specific amount (needed to wait until new withdraw request elapses).

  Alternatively, cancel the current withdrawal request and create a new one with a larger `--amount` to cover
  additional staking rewards earned by stake accounts during the delayed period until claiming is permitted.
  For example, the new withdrawal request could specify `--amount` as 5 SOLs instead of 4 SOLs for this particular example,
  or use term `"ALL"` (`--amount ALL`) to declare the desire to withdraw everything from the bond regardless of anything.

* **Transaction simulation failed: Attempt to debit an account but found no record of a prior credit.**
  <a id='troubleshooting-attempt-debit'></a>

  The executed command sends the transaction on-chain. For the transaction to be processed, a wallet must pay
  the [transaction fee](https://solana.com/docs/core/fees) (approximately 5000 lamports).
  The CLI attempts to use the default wallet payer, which is typically the default Solana CLI keypair
  (usually located at `$HOME/.config/solana/id.json`; see CLI configuration with `solana config get`).
  If this wallet address has insufficient funds to cover the transaction fee, you will encounter this error.

  To verify which keypair is being used, add the `--verbose` switch to your command.

  **Solution:**

  Use the `-k <keypair-path>` parameter to specify a keypair wallet that has sufficient lamports to pay the transaction fee.