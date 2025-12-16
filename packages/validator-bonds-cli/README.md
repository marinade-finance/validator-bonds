# Validator Bonds CLI

CLI for [Marinade](https://docs.marinade.finance/) Validator Bonds on-chain program.

## Table of Contents

- [Prerequisites & Installation](#prerequisites--installation)
- [Quick Start Guide](#quick-start-guide)
- [Core Concepts](#core-concepts)
- [Bond Management](#bond-management)
- [Understanding Bond Processing](#understanding-bond-processing)
- [Advanced Topics](#advanced-topics)
- [CLI Reference](#cli-reference)
- [Troubleshooting and FAQ](#troubleshooting)

## Prerequisites & Installation

**Requirements:** Node.js version 20 or higher.

### Global Installation

To install the CLI as a global npm package:

```sh
npm install -g @marinade.finance/validator-bonds-cli@latest
```

Successful installation output:

```
added 199 packages in 20s

19 packages are looking for funding
  run `npm fund` for details
```

### Verify Installation

```sh
validator-bonds --help
validator-bonds --version
```

For detailed information on npm package installation, troubleshooting, and alternative installation methods, see [NPM Installation Details](#npm-installation-details).

## Quick Start Guide

This guide shows the essential steps for a validator to participate in Marinade's stake distribution program.

### Overview

To be eligible for stake distribution, you need to:

1. **Create a bond** - Link your vote account to the Validator Bonds program
2. **Fund the bond** - Add SOL as collateral (approximately 1 SOL per 10,000 SOL staked)
3. **Configure your bid** - Set how much rewards you'll share with stakers
4. **Verify** - Confirm your bond is properly funded and configured

### Step-by-Step Commands

```sh
# STEP 1: INITIALIZE BOND
# initializing the bond account for vote-account
validator-bonds init-bond --vote-account <vote-account-address> \
  --validator-identity ./validator-identity.json
> Bond account BondAddress9iRYo3ZEK6dpmm9jYWX3Kb63Ed7RAFfUc of config vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4 successfully created

# STEP 2: FUND BOND
# ---
# OPTION A STEP 2: Funding from a wallet
# In background the number of SOL is transferred to a stake account and assigned under Validator Bonds program
validator-bonds fund-bond-sol <vote-account-address> --from <wallet-keypair> --amount <Amount of SOL

# OPTION B STEP 2: Funding with a stake account
# ---
# Create a random keypair for a stake account to be created and funded to bond
# The Validator Bonds program does not preserve stake account public keys as it merges and splits them
solana-keygen new -o /tmp/stake-account-keypair.json
# Creating a stake account. The SOLs will be funded to the Bond
solana create-stake-account <stake-account-keypair> <Amount of SOL 1 for every 10,000 staked>
# To couple the created stake account with the vote account, plus activates it
solana delegate-stake <stake-account-pubkey> <vote-account-address>
# Funding Bond by assigning the stake account with the SOL amount in it
validator-bonds fund-bond <vote-account-address> --stake-account <stake-account-pubkey>

# STEP 3: CONFIGURE YOUR BID
# Set how much rewards you'll share with stakers through bidding.
# You can use one or both bidding methods:
# ---
# a) Static bid (--cpmpe): Fixed cost per 1000 SOL delegated
#    Example: --cpmpe 100 means you pay 100 lamports per 1000 SOL per epoch
## b) Commission-based bid: Share a percentage of your rewards
#    Use basis points (1% = 100 bps, 5% = 500 bps)
#    Example: --block-commission 500 means you share 5% of block rewards
#    Available: --inflation-commission, --mev-commission, --block-commission
# Learn more: https://docs.marinade.finance/marinade-protocol/protocol-overview/stake-auction-market
validator-bonds configure-bond <vote-account-address> --authority ./validator-identity.json \
  --cpmpe 100 --block-commission 500

# STEP 4: VERIFICATION
# Check the new configuration
validator-bonds show-bond <vote-account-address>

# Track detailed funding information (requires non-public RPC)
RPC_URL=<url-to-solana-rpc-node>
validator-bonds -u $RPC_URL show-bond <vote-account-address> --with-funding
```

**Next Steps:** Read the [Core Concepts](#core-concepts) section to understand how bonds, auctions, and settlements work, then explore the detailed [Bond Management](#bond-management) commands.

---

## Core Concepts

### What is a Bond?

A **bond** is an on-chain account that links your validator's vote account to the Marinade Validator Bonds program. It serves as collateral and enables you to participate in Marinade's stake distribution auction.

Key properties:

- **One bond per vote account** - Each validator can have exactly one bond
- **Collateral** - Funded with stake accounts to secure commitments
- **Configurable** - Set your bidding strategy and reward sharing
- **Withdrawable** - Funds can be withdrawn after a lockup period

### How the Auction Works

Validators compete for Marinade's delegated stake by bidding how much rewards they'll share with stakers. The auction runs every epoch and determines:

- Which validators receive delegated stake
- How much stake each validator receives
- What each validator pays for the delegation

**Bidding options:**

1. **Static bid (CPMPE)** - Cost Per Mille Per Epoch: fixed lamports per 1000 SOL delegated
2. **Commission-based bid** - Share a percentage of specific reward types (inflation, MEV, block rewards)
3. **Combined** - Use both methods together

### What are Settlements?

A **settlement** is created after each epoch based on auction results. It represents:

- The amount you owe for delegated stake
- Rewards to be distributed to stakers
- Protected staking events (if your validator underperformed)

Settlements are funded from your bond and can be claimed by stakers for approximately 4 epochs. Unclaimed funds return to your bond.

---

## Bond Management

### Creating a Bond

A bond account is strictly coupled with a vote account and can be created in two ways:

**With Authority (requires validator identity):**

- Requires `--validator-identity <keypair>` signature at creation
- Allows setting a custom `--bond-authority` for managing the bond
- Recommended for better security (can use multisig or hardware wallet)
- The bond authority can be any public key

**Without Authority (permission-less):**

- Anyone can create the bond account for any vote account
- The validator identity becomes the default authority
- Validator identity signature required for all future changes
- Useful for setting up bonds without validator cooperation

**Important:**

- Only one bond can exist per vote account
- Every bond is linked to a vote account

**Command Examples:**

```sh
# With authority: Creating bond with custom authority (recommended)
validator-bonds -um init-bond -k <fee-payer-keypair> \
  --vote-account <vote-account-pubkey> \
  --validator-identity <validator-identity-keypair> \
  --bond-authority <authority-pubkey> \
  --rent-payer <rent-payer-keypair>

# Without authority: Permission-less bond creation
validator-bonds -um init-bond -k <fee-payer-keypair> \
  --vote-account <vote-account-pubkey> \
  --rent-payer <rent-payer-keypair>

# View all configuration options
validator-bonds -um configure-bond --help
```

#### Parameter Details

**Transaction Parameters:**

- `-k <fee-payer-keypair>` - Account that pays transaction fees (~5000 lamports)
- `--rent-payer <keypair>` - Account that pays rent for creating the bond account (~0.00270048 SOL). Defaults to fee payer if not specified

**Bond Setup Parameters:**

- `--vote-account <pubkey>` - The vote account to link with this bond
- `--validator-identity <keypair>` - Validator identity signature (must match the vote account's identity)
- `--bond-authority <pubkey>` - Public key that will control this bond. Can be any address (multisig/ledger recommended). Does not need to be an existing account

**Important Notes:**

- The rent cost is only for creating the account, not for bond funding
- The bond creation may consist of few more accounts than only a single bond account
- Bond funding is done separately by assigning stake accounts (see [Funding a Bond](#funding-a-bond))
- **Never** send SOL directly to a bond account (the Bond funding always uses stake accounts)

**Auction Bidding Parameters** (can also be set later with `configure-bond`):

- `--cpmpe <lamports>`: Cost per mille per epoch. It's a bid used in the delegation strategy
  auction. The Bond owner agrees to pay this amount in lamports to get stake delegated to the vote
  account for one epoch.
  The actual amount of delegated stake is calculated by the [SAM delegation strategy](https://docs.marinade.finance/marinade-protocol/protocol-overview/stake-auction-market).
  The maximum delegated stake per validator is configured by Marinade SAM configuration as a percent of full Marinade TVL
  (configured at [ds-sam-pipeline](https://github.com/marinade-finance/ds-sam-pipeline/)
  in [the config as `maxMarinadeTvlSharePerValidatorDec`](https://github.com/marinade-finance/ds-sam-pipeline/blob/main/auction-config.json)).
  The `cpmpe` value evaluated in the SAM auction where compared with other bids to determine the stake for the validator
  that has to have an existing and funded `Bond`.
- `--inflation-commission <bps>`: Inflation commission (may be negative, max 100%/10,000 bps),
  specifying the portion of inflation rewards the validator keeps. This re-declares the on-chain inflation
  value for use in the Marinade SAM auction.
- `--mev-commission <bps>`: MEV commission (may be negative, max 100%/10,000 bps), specifying the portion
  of MEV rewards the validator keeps. This re-declares the on-chain MEV value for use in the Marinade SAM auction.
- `--block-commission <bps>`: Block rewards commission (may be negative, max 100%/10,000 bps), specifying
  the portion of block rewards the validator keeps. The remainder is shared with stakers through bond claims.
- `--max-stake-wanted <lamports>` - Maximum stake amount you want delegated

**Auction Bidding Notes:**

- Parameters are evaluated in the SAM auction against other validators' bids.
- Only charged for actual stake delegated (no delegation = no charge)
- See [SAM delegation strategy](https://docs.marinade.finance/marinade-protocol/protocol-overview/stake-auction-market)

### Showing Bond Information

View basic bond information (works with public RPC):

```sh
validator-bonds -um show-bond <bond-or-vote-account-address>
```

View detailed bond information including funding details:

```sh
# Requires a private RPC endpoint (public endpoints rate-limit these calls)
RPC_URL=<your-rpc-url>
validator-bonds -u $RPC_URL show-bond <bond-or-vote-account-address> --with-funding --verbose
```

**Note:** The `--with-funding` flag makes multiple RPC calls and won't work with public endpoints (see [Troubleshooting](#troubleshooting) for RPC options).

**Example output:**

```json
{
  "programId": "vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4",
  "publicKey": "...",
  "account": {
    "config": "vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU",
    "voteAccount": "...",
    "authority": "...",
    "costPerMillePerEpoch": "1000 lamports",
    "maxStakeWanted": "100000 SOLs"
  },
  "configs": [
    {
      "publicKey": "...",
      "productType": "commission",
      "configData": {
        "commission": {
          "inflationBps": 500,
          "mevBps": 1000,
          "blockBps": 200
        }
      }
    }
  ],
  "voteAccount": {
    "nodePubkey": "...",
    "authorizedWithdrawer": "...",
    "commission": 100
  },
  "amountOwned": "42.407 SOLs",
  "amountActive": "42.407 SOLs",
  "numberActiveStakeAccounts": 5,
  "amountAtSettlements": "0 SOL",
  "numberSettlementStakeAccounts": 0,
  "amountToWithdraw": "0 SOL",
  "withdrawRequest": "<NOT EXISTING>",
  "bondMint": "...",
  "bondFundedStakeAccounts": [ ... ],
  "settlementFundedStakeAccounts": []
}
```

#### Understanding Amount Fields

The output shows several amount fields that track different states of your bond funding:

**`amountActive`** - SOL available for settlements and bidding

```
amountActive = amountOwned - amountAtSettlements - amountToWithdraw
```

**Key fields:**

- **`amountOwned`**: The total amount available at the Bond account.
- **`amountAtSettlements`**: The amount reserved in existing Settlements, waiting to be claimed by stakers.
  If not claimed, this amount is returned to the Bond account and reflected in `amountActive`.
- **`amountToWithdraw`**: The amount the user has requested to withdraw, which is no longer considered
  active for bond bidding. However, the funds may still be used for settlement funding
  until they are fully withdrawn from the Bonds program.
- **`numberActiveStakeAccounts`**: Count of stake accounts in which the active part of the bond is held.
  These accounts collectively represent the `amountActive`.
- **`numberSettlementStakeAccounts`**: Count of stake accounts currently held in Settlements that
  together represent the `amountAtSettlements`.
- **`withdrawRequest`**: Indicates whether a withdrawal request exists for the Bond account.
  If present, it shows the request’s public key and the `amountToWithdraw` it corresponds to.

**Special case - Negative `amountActive`:**
If you see a large negative value like `"-18446744053.751394957 SOL"`, it means you created a withdrawal request for "ALL" funds. This is normal and indicates no funds are available for new settlements. See [Withdrawing from a Bond](#withdrawing-from-a-bond) for details.

---

### Configuring a Bond

You can modify an existing bond's configuration at any time. The bond authority or validator identity keypair
or SPL token holder must sign the transaction.

**Configurable Properties:**

- `--bond-authority <pubkey>` - Change the authority that controls this bond
  - Current authority, validator identity, or SPL token holder can make this change
  - See [Permission-less Mint-Configure Workflow](#permission-less-mint---configure-workflow) for token-based configuration
- `--cpmpe <lamports>` - Cost Per Mille Per Epoch (static bid)
  - Amount in lamports to pay per 1000 SOL delegated per epoch
  - Example: 100 lamports per 1000 SOL per epoch
- `--inflation-commission <bps>` - Inflation rewards commission (0-10,000, can be negative)
  - Percentage of inflation rewards you keep (in basis points).
    Difference between on-chain configured inflation and this value is shared with stakers through bond settlements.
  - Re-declares your on-chain commission for SAM auction calculations
  - Example: 500 = 5%
- `--mev-commission <bps>` - MEV rewards commission (0-10,000, can be negative)
  - Percentage of MEV rewards you keep.
    Difference between on-chain configured MEV and this value is shared with stakers through bond settlements.
- `--block-commission <bps>` - Block rewards commission (0-10,000, can be negative)
  - Percentage of block rewards you keep
  - Remainder is distributed to stakers through bond settlements
- `--max-stake-wanted <lamports>` - Maximum stake to accept
  - Caps the amount of stake Marinade can delegate to you

> **NOTE:** Configuration data may be stored in separate PDA accounts linked to the bond.
> In such cases, **a new PDA account** may be created when configuring the bond
> (this happens only once per configuration type). Then the `--rent-payer <keypair>` parameter is used
> to pay the rent for creating the new account.

#### Configure with Authority (permissioned)

```sh
validator-bonds -um configure-bond <bond-or-vote-account-address> \
  --authority <authority-keypair> \
  --cpmpe 100 \
  --block-commission 500
```

To change the authority itself:

```sh
validator-bonds -um configure-bond <bond-or-vote-account-address> \
  --authority <current-authority-keypair> \
  --bond-authority <new-authority-pubkey>
```

#### Permission-less Mint - Configure Workflow

This is an _alternative method_ for configuring bonds without directly using the validator identity to sign transactions. It's useful when you want to delegate configuration authority without exposing the validator identity key.

**How it works:**

1. **Mint a bond token** (requires validator identity):

```sh
validator-bonds -um mint-bond <bond-or-vote-account-address>
```

This creates an SPL token sent to the validator identity wallet.

The owner of the `validator identity` keypair may transfer the token
to any other account using standard means.

Later, when they want to configure the bond account,
it's required to verify ownership of the Bond's SPL token.

The owner of the token signs the CLI generated transaction,
and the Bonds program burns the Bond's SPL token, allowing configuration of the authority.

2. **Configure using the token** (token holder signs, token is burned):

```sh
validator-bonds -um configure-bond <bond-or-vote-account-address> \
  --authority <token-owner-keypair> \
  --bond-authority <new-authority-pubkey> \
  --with-token
```

The token is burned during configuration, proving ownership without requiring the validator identity to sign the configuration transaction.

---

<a id='funding-bond-account'></a>

### Funding a Bond

Bonds are funded with stake accounts, not direct SOL transfers. The funded amount serves as collateral for auction bids and settlement obligations.

> **⚠️ CRITICAL WARNINGS:**
>
> - **NEVER** send SOL directly to a bond account, **ALWAYS** use the `fund-bond` or `fund-bond-sol` CLI commands

#### Option 1: Fund with SOL

```sh
validator-bonds fund-bond-sol <vote-account-address> \
  --from <wallet-keypair> \
  --amount <amount-in-SOL>
```

This command creates a new stake account, funds it with your specified SOL amount,
delegates it to your vote account, and assigns it to the bond.

#### Option 2: Fund with an Existing Stake Account

For validators who already have stake accounts:

**Requirements:**

- Stake account **must be delegated** to your bond's vote account
- Stake account **must be activating or activated** (not deactivated)

**Steps:**

1. Create and fund a stake account (if needed):

```sh
# Generate a keypair for the stake account
solana-keygen new -o /tmp/stake-account.json

# Create and fund the stake account
solana create-stake-account /tmp/stake-account.json <amount-in-SOL>

# Delegate to your vote account
solana delegate-stake <stake-account-pubkey> <vote-account-address>
```

2. Assign the stake account to your bond:

```sh
validator-bonds -um fund-bond <bond-or-vote-account-address> \
  --stake-account <stake-account-address> \
  --stake-authority <stake-authority-keypair>
```

**Parameters:**

- `<bond-or-vote-account-address>` - Your bond or vote account
- `--stake-account` - Address of the stake account to assign
- `--stake-authority` - Keypair with authority to modify the stake account (usually the withdrawer)

#### Adding More Funds

Simply fund additional stake accounts to your bond using either method above.
The bond's total funding is the sum of all stake accounts.

**Note:** The Validator Bonds program may merge or split stake accounts as needed for settlements.
Individual stake account public keys are not preserved, but the total SOL amount is always tracked.

#### How Stake Accounts Work in Bonds

The Validator Bonds on-chain program uses stake accounts, which introduces challenges such as managing account splitting
and merging during settlements. The main reason for this design &mdash; and its benefit &mdash; is that it allows you to
**continue earning inflation rewards while your funds are locked as collateral**.

During settlement events, stake accounts may be split: one part covers the settlement, while the remaining portion stays in the bond. After a settlement expires, any unclaimed funds return to your bond. The program handles these account operations automatically, ensuring that your total funded amount is preserved even as individual stake accounts change.

---

### Withdrawing from a Bond

Withdrawals return stake account ownership to you, allowing you to stop participating in auctions
and [protected staking events](https://marinade.finance/blog/introducing-protected-staking-rewards/).

**The withdrawal process has two steps:**

1. **Initialize withdrawal request** (~3 epochs lockup period begins)
2. **Claim withdrawal request** (after lockup expires, stake accounts transferred to you)

<a id='withdraw-all'></a>

> **⚠️ IMPORTANT NOTES:**
>
> - Funds in withdrawal requests are **excluded from `amountActive`** and can't be used for bidding
> - To withdraw **all funds**, use `--amount ALL` (sets amount to maximum value ~18e18 lamports)
> - Withdrawal requests remain on-chain until you cancel them (see [Cancelling a Withdrawal Request](#cancelling-a-withdrawal-request))

#### Step 1: Initialize Withdrawal Request

```sh
validator-bonds -um init-withdraw-request <bond-or-vote-account-address> \
  --authority <bond-authority-keypair> \
  --amount <lamports-or-ALL>
```

**Parameters:**

- `--authority` - Your bond authority keypair or validator identity
- `--amount` - Maximum lamports to withdraw, or `ALL` for everything

**Notes:**

- You can request more than your current funded amount
- To change the amount, you must cancel and create a new request (with new lockup period)
- The lockup period is program wide configuration option (currently ~3 epochs)

#### Step 2: Claim Withdrawal Request

After the lockup period expires (~3 epochs):

```sh
validator-bonds -um claim-withdraw-request <withdraw-request-or-bond-address> \
  --authority <bond-authority-keypair> \
  --withdrawer <destination-pubkey>
```

**Parameters:**

- `--authority` - Your bond authority or validator identity
- `--withdrawer` - Public key that will own the returned stake accounts (defaults to your CLI wallet)

The stake account(s) are transferred with both staker and withdrawer authorities set to `--withdrawer`.

#### Step 3 (Optional): Convert Stake to SOL

Transferring funds from the claimed stake account to a wallet

```sh
# Get the stake account address from the claim-withdraw-request output

# 1. Deactivate the stake
solana deactivate-stake <stake-account-address> \
  --stake-authority <withdrawer-keypair>

# 2. Wait for deactivation (one epoch)

# 3. Withdraw to your wallet
solana withdraw-stake <stake-account-address> <destination-wallet> <amount> \
  --withdraw-authority <withdrawer-keypair>
```

##### Technical details on creating and claiming a withdrawal request

A withdrawal request designates a fixed number of lamports to be withdrawn after the 3-epoch delayed claiming period.
This value is the maximum withdrawable amount, even if staking rewards accrue in the meantime and increase the actual
lamports in the stake accounts.

When claiming (`claim-withdraw-request`), you must choose the stake account from which the withdrawal is taken.
This usually splits the stake account: the requested amount is transferred to the withdrawer,
and the remainder stays in the validator bonds contract.

A claim may fail if the requested withdrawal amount leaves behind an invalid stake account after splitting.
A valid delegated stake account must:

- include the rent-exempt minimum (`~0.002282880` SOL), and
- contain additional lamports beyond rent (currently at least `1` lamport, subject to change).

To mirror this, the contract defines a `Config` parameter
[`minimum_stake_lamports`](https://github.com/marinade-finance/validator-bonds/blob/contract-v2.0.0/programs/validator-bonds/src/state/config.rs#L19),
enforcing the minimum lamports locked in each stake account. This is especially relevant for stake accounts parked
in a `Settlement`, where the locked amount remains until the `Settlement` is closed.

If the remaining lamports after the split do not meet this minimum, `claim-withdraw-request` will fail.
For more details, see the [FAQ section on failed withdrawal requests](#faq-and-issues).

---

#### Cancelling a Withdrawal Request

You can cancel a withdrawal request at any time:

```sh
validator-bonds -um cancel-withdraw-request <withdraw-request-or-bond-address> \
  --authority <bond-authority-keypair>
```

**Why cancel?**

- Change the withdrawal amount (must cancel, then create new request)
- Return funds to active bidding status
- Remove a completed withdrawal request from the chain

**Important:** Only one withdrawal request can exist per bond. With `--amount ALL`, even future funding is marked for withdrawal. Check status with `show-bond`.

#### Technical Notes on Withdrawals

**Stake account splitting:**
Withdrawals typically split stake accounts - one part goes to you, the rest stays in the bond.
This requires meeting minimum stake account sizes:

- Rent reserve: ~0.002282880 SOL (required for all Solana accounts)
- Minimum delegation: Set by
  [`minimumStakeLamports` in config](https://github.com/marinade-finance/validator-bonds/blob/contract-v2.0.0/programs/validator-bonds/src/state/config.rs#L19)

**Staking rewards during lockup:**
Rewards earned during the lockup period can cause the stake account balance to exceed your requested amount.
The system withdraws only the requested amount - excess stays in the bond.

If withdrawal fails due to minimum stake requirements,
see [Troubleshooting: Failed to claim withdraw request](#troubleshooting) for solutions.

### Program Configuration

View the global Validator Bonds program configuration:

```sh
# Marinade's config account address
validator-bonds -um show-config vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU
```

**Key configuration parameters:**

- `epochsToClaimSettlement` - How long settlements can be claimed (~4 epochs)
- `slotsToStartSettlementClaiming` - Delay before settlement claiming starts
- `withdrawLockupEpochs` - Withdrawal request lockup period (~3 epochs)
- `minimumStakeLamports` - Minimum stake account size for splits
- `minBondMaxStakeWanted` - Minimum allowed `maxStakeWanted` value

[View config source code](https://github.com/marinade-finance/validator-bonds/blob/main/programs/validator-bonds/src/state/config.rs)

---

## Understanding Bond Processing

This section explains how auctions work, when settlements are created, and how validators are charged.

### Timeline

Bond processing follows a one-epoch delay:

- **Epoch X**: Auction determines delegation, stake is delegated
- **Epoch X+1 start**: Settlements created and charged based on epoch X data

### The Auction Process

Each epoch, validators' bids (combined static + dynamic commission ones) determine stake allocation.
The auction calculates an `auctionEffectiveBidPmpe` (effective bid per mille per epoch) for each validator
that defines the position in auction.

The validator is charged from their bond based on the Marinade weighted stake delegated,
gained rewards and their effective static bid.

The dynamic commissions part is charged from the rewards earned by the validator in epoch X.
The difference between on-chain configured commissions and actual commissions
is calculated to charged from the bond.
For static bids, the validator is charged based on the amount of stake delegated in epoch X.
If the effective static bid is 0.1 and the assigned stake is 100,000 SOLs,
the validator is charged for 10 SOLs (0.1 × 100,000) from their bond.

### Settlement Creation

At the start of epoch X+1, the system:

1. Reviews how much SOL Marinade delegated in epoch X (from Solana snapshot) and what rewards were earned in epoch X
2. Creates on-chain settlement accounts funded from your bond
3. Makes settlements claimable by stakers for ~4 epochs
4. Returns unclaimed funds to your bond after expiration

### Protected Staking Rewards (PSR)

Bonds are also charged for [PSR events](https://marinade.finance/how-it-works/psr) when validators underperform.

**How it works:**

- "Uptime" = voting uptime ([vote credits](https://docs.anza.xyz/proposals/timely-vote-credits) earned)
- System ensures validators meet network-average inflation rewards
- Validators below average are charged to cover the difference
- A settlement is created for affected stakers

### Verifying Your Bond Status

**Current on-chain status:**

```sh
validator-bonds -um show-bond <your-vote-account>
```

**Historical data:**

- [https://psr.marinade.finance](https://psr.marinade.finance/): PSR Dashboard, visual overview
- [https://scoring.marinade.finance/api/v1/scores/sam?epoch=X](https://scoring.marinade.finance/api/v1/scores/sam?epoch=X):
  Auction API Epoch-specific data
- [GCS Storage](https://console.cloud.google.com/storage/browser/marinade-validator-bonds-mainnet): Raw settlement data
- [ds-sam-pipeline auction data](https://github.com/marinade-finance/ds-sam-pipeline/tree/main/auctions) (`<epoch>/outputs/results.json`)
- [Discord PSR feed channel](https://discord.com/channels/823564092379627520/1223330302890348754)

**Note:** `show-bond` shows current state, which may differ from data used for a specific epoch's calculations.

---

## Advanced Topics

### Searching for Funded Stake Accounts

All stake accounts funded to bonds have a specific withdrawal authority that you can query.

**Withdrawal authority addresses:**

- **Standard Marinade Bonds**: `7cgg6KhPd1G8oaoB48RyPDWu7uZs51jUpDYB3eq4VebH`
- **Institutional Bonds**: `8CsAFqTh75jtiYGjTXxCUbWEurQcupNknuYTiaZPhzz3`

See [On-Chain Technical Information](#on-chain-technical-information) for more details.

#### Query All Bond-Funded Stake Accounts

Use the `getProgramAccounts` RPC method to find all stake accounts with the bond withdrawal authority:

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

#### Query Stake Accounts for a Specific Validator

To find stake accounts for a particular validator, add a filter on the voter pubkey:

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
        "dataSlice": {"offset": 0, "length": 0},
        "filters": [
          {"memcmp": {"offset": 44, "bytes": "7cgg6KhPd1G8oaoB48RyPDWu7uZs51jUpDYB3eq4VebH"}},
          {"memcmp": {"offset": 124, "bytes": "<your-vote-account-address>"}}
        ]
      }
    ]
  }
' | jq '.'
```

**Stake account data layout offsets:**

- `12` - Staker authority (4 bytes enum + 8 bytes rent reserve)
- `44` - Withdrawer authority (12 + 32 bytes staker pubkey)
- `124` - Voter pubkey / delegation target (44 + 80 bytes meta)

For technical details, see Solana source:
[staker/withdrawer](https://github.com/solana-labs/solana/blob/v1.17.15/sdk/program/src/stake/state.rs#L60),
[voter pubkey](https://github.com/solana-labs/solana/blob/v1.17.15/sdk/program/src/stake/state.rs#L414)

---

### Ledger Support

The CLI supports hardware wallet signatures through Ledger devices. Use either the pubkey
or derivation path format for any parameter that accepts a keypair.

**Ledger URL formats:**

- By pubkey: `usb://ledger/<pubkey>`
- By derivation path: `usb://ledger?key=<path>`

**Example Usage:**

```sh
# Find the pubkey for a derivation path
solana-keygen pubkey 'usb://ledger?key=0/3'

# Configure bond using Ledger to sign
validator-bonds -um configure-bond \
  --authority 'usb://ledger?key=0/3' \
  --bond-authority <new-authority-pubkey> \
  <bond-account-address>
```

**Implementation:** Built on [`@marinade.finance/ledger-utils`](https://github.com/marinade-finance/marinade-ts-cli/tree/main/packages/lib/ledger-utils),
a TypeScript wrapper around `@ledgerhq/hw-app-solana`, a behaviour compatible with the
[Solana CLI ledger implementation](https://github.com/solana-labs/solana/blob/v1.14.19/clap-utils/src/keypair.rs#L613).

---

### NPM Installation Details

This section covers advanced NPM installation scenarios and troubleshooting.

#### Checking Your NPM Configuration

View current configuration:

```sh
npm config list          # Show all config
npm list -g              # Show global packages location
npm config get cache     # Cache location
npm config get prefix    # Install prefix
```

When installed globally

```sh
# Get npm global installation folder
npm list -g
> /usr/lib
> +-- @marinade.finance/validator-bonds-cli@2.3.1
> ...
# In this case, the `bin` folder is located at /usr/bin
```

#### User-Space Installation

If global packages require root access, configure user-local installation:

```sh
# Set user-local paths
npm config set cache ~/.cache/npm
npm config set prefix ~/.local/share/npm

# Install globally to user space
npm i -g @marinade.finance/validator-bonds-cli@latest

# Verify installation
npm list -g
# Output: ~/.local/share/npm/lib
#         └── @marinade.finance/validator-bonds-cli@2.3.1
```

To execute the installed packages from any location,
configure the `PATH` to place the newly defined user workspace local installation before others.

```sh
# the nodejs binaries reside in '~/.local/share/npm/bin' for this particular case
NPM_LIB=`npm list -g | head -n 1`
export PATH=${NPM_LIB/%lib/bin}:$PATH
```

#### Local Directory Execution (No Global Install)

Run the CLI without global installation:

```sh
# Install to local directory
cd /tmp
npm install @marinade.finance/validator-bonds-cli@latest

# `node_modules` exists in the folder and contains the CLI and its dependencies
ls node_modules
# Execute from the local directory
npm exec -- validator-bonds --version
```

This is useful for testing specific versions or avoiding global installation.

---

## On-Chain Technical Information

**Program Addresses:**

- **Validator Bonds Program**: `vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4`
- **Marinade Config Account**: `vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU`

**Authority Addresses:**

- **Native Staking Staker Authority**: `stWirqFCf2Uts1JBL1Jsd3r6VBWhgnpdPxCTe1MFjrq`
- **Bond Stake Withdrawer Authority**: `7cgg6KhPd1G8oaoB48RyPDWu7uZs51jUpDYB3eq4VebH`

---

## CLI Reference

Complete command reference for the Validator Bonds CLI.

### Global Options

```sh
validator-bonds --help
Usage: validator-bonds [options] [command]

Options:
  -V, --version                                   output the version number
  -u, --url <rpc-url>                             solana RPC URL or a moniker (m/mainnet/mainnet-beta, d/devnet, t/testnet, l/localhost), see https://solana.com/rpc (default: "mainnet", env: RPC_URL)
  -c, --cluster <cluster>                         alias for "-u, --url"
  -k, --keypair <keypair-or-ledger>               Wallet keypair (path or ledger url in format usb://ledger/[<pubkey>][?key=<derivedPath>]). Wallet keypair is used to pay for the transaction fees and as default value for signers.
                                                  (default: loaded from solana config file or ~/.config/solana/id.json)
  -s, --simulate                                  Simulate (default: false)
  -p, --print-only                                Print only mode, no execution, instructions are printed in base64 to output. This can be used for placing the admin commands to SPL Governance UI by hand. (default: false)
  --skip-preflight                                Transaction execution flag "skip-preflight", see https://solanacookbook.com/guides/retrying-transactions.html#the-cost-of-skipping-preflight (default: false)
  --commitment <commitment>                       Commitment (default: "confirmed")
  --confirmation-finality <confirmed|finalized>   Confirmation finality of sent transaction. Default is "confirmed" that means for majority of nodes confirms in cluster. "finalized" stands for full cluster finality that takes ~8
                                                  seconds. (default: "confirmed")
  --with-compute-unit-price <compute-unit-price>  Set compute unit price for transaction, in increments of 0.000001 lamports per compute unit. (default: 10)
  -d, --debug                                     Printing more detailed information of the CLI execution (default: false)
  -v, --verbose                                   alias for --debug (default: false)
  --program-id <pubkey>                           Program id of validator bonds contract (default: vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4) (default: {})
  -h, --help                                      display help for command

Commands:
  init-config [options]                           Create a new config account.
  configure-config [options] [address]            Configure existing config account.
  mint-bond [options] <address>                   Mint a Validator Bond token, providing a means to configure the bond account without requiring a direct signature for the on-chain transaction. The workflow is as follows: first, use
                                                  this "mint-bond" to mint a bond token to the validator identity public key. Next, transfer the token to any account desired. Finally, utilize the command "configure-bond --with-token"
                                                  to configure the bond account.
  init-bond [options]                             Create a new bond account.
  configure-bond [options] <address>              Configure existing bond account.
  merge-stake [options]                           Merging stake accounts belonging to validator bonds program.
  fund-bond [options] <address>                   Funding a bond account with amount of SOL within a stake account.
  fund-bond-sol [options] <address>               Funding a bond account with amount of SOL. The command creates a stake account, transfers SOLs to it and delegates it to bond.
  init-withdraw-request [options] [address]       Initializing withdrawal by creating a request ticket. The withdrawal request ticket is used to indicate a desire to withdraw the specified amount of lamports after the lockup period
                                                  expires.
  cancel-withdraw-request [options] [address]     Cancelling the withdraw request account, which is the withdrawal request ticket, by removing the account from the chain.
  claim-withdraw-request [options] [address]      Claiming an existing withdrawal request for an existing on-chain account, where the lockup period has expired. Withdrawing funds involves transferring ownership of a funded stake
                                                  account to the specified "--withdrawer" public key. To withdraw, the authority signature of the bond account is required, specified by the "--authority" parameter (default wallet).
  pause [options] [address]                       Pausing Validator Bond contract for config account
  resume [options] [address]                      Resuming Validator Bond contract for config account
  close-settlement [options] <address>            Closing Settlement. It is a permission-less action permitted when the Settlement expires. To finalize closing the dangling stake accounts need to be reset.
  reset-stake [options] <address>                 Resetting stake that is not associated to a closed Settlement. The stake account is to be returned to Bond then used for funding another settlement.
  show-config [options] [address]                 Showing data of config account(s)
  show-event [options] <event-data>               Showing data of anchor event
  show-bond [options] [address]                   Showing data of bond account(s)
  show-settlement [options] [address]             Showing data of settlement account(s)
  bond-address [options] <address>                From provided vote account address derives the bond account address
  help [command]                                  display help for command

```

---

## Troubleshooting

**General debugging tips:**

- Always use the [latest version](https://www.npmjs.com/package/@marinade.finance/validator-bonds-cli)
- Run commands with `--verbose` for detailed output
- Check [Known Issues](#faq-and-issues) below for common problems

## FAQ and issues

- **npm WARN EBADENGINE Unsupported engine {**<a id='troubleshooting-npm-ebadengine'></a>

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

- **ExecutionError: Transaction XYZ not found**<a id='troubleshooting-execution-error'></a>

  The CLI sent the transaction to blockchain but because of a connection
  or RPC issue the client was not capable to verify that the transaction
  has been processed successfully on chain

  ```
  err: {
        "type": "ExecutionError",
        "message": "... : Transaction ... not found, failed to get from ...",
        "stack":
            Error: ...
                at executeTx (/usr/local/lib/node_modules/@marinade.finance/validator-bonds-cli/node_modules/@marinade.finance/web3js-1x/src/tx.js:86:15)
  ```

  **Solution:** Verify if the transaction `XYX` is at blockchain with a transaction explorer,
  e.g., https://explorer.solana.com/.
  Verify with the CLI. For example when bond should be initialized (`init-bond`)
  you can run search with CLI `validator-bonds -um show-bond <bond-or-vote-account>`
  to check if account was created.

- **bigint: Failed to load bindings, ...**<a id='troubleshooting-bigint-bindings'></a>

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

- **npm i -g @marinade.finance/validator-bonds-cli@latest**<a id='troubleshooting-latest-version'></a>
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
  > `-- @marinade.finance/validator-bonds-cli@2.3.1
  # In this case, the 'bin' folder is located at ~/.local/share/npm/bin

  # Get validator-bonds binary folder
  which validator-bonds
  > /usr/bin/validator-bonds
  ```

  **Solution:**

  Apply one of the following suggestions:
  - Remove the binary from the location reported by the `which` command, ``sudo rm -f `which validator-bonds` ``
  - Change `PATH` to prioritize the `npm -g` folders, ``NPM_LIB=`npm list -g | head -n 1`; export PATH=${NPM_LIB/%lib/bin}:$PATH``
  - Use local `npm exec` execution instead of global installation, see the section [_NPM Exec From Local Directory_](#npm-exec-from-local-directory)

- **Command yields `The RPC call or parameters have been disabled`**<a id='troubleshooting-rpc-disabled'></a>

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
  - To retrieve printed data about one particular bond account, this error should not be seen.
    Use a simple call of `show-bond <vote-account>`
    and **DO NOT** use filter arguments like `show-bond --vote-account <address>`.
  - Use a private RPC endpoint (see https://solana.com/rpc). Most providers offer free plans
    that can be easily used: `RPC_URL=<private-rpc-http-endpoint>; show-bond -u$RPC_URL...`

- **command fails with `429 Too Many Requests`**<a id='troubleshooting-too-many-requests'></a>

  This error often occurs when the `show-bond` command is used with the public RPC API endpoint
  `https://api.mainnet-beta.solana.com`, which is the default endpoint for CLI commands.
  To display all the details, the CLI often needs to execute multiple RPC queries.
  Public RPC nodes impose rate limits, and exceeding these limits results in the
  `429 Too Many Requests` error.

  **Solution:**
  - Use a private RPC endpoint (see https://solana.com/rpc).
    Most providers offer free plans that can be easily utilized:
    `RPC_URL=<private-rpc-http-endpoint>; show-bond -u $RPC_URL...`

- **node_modules/@solana/webljs/lib/index.cjs.js:643 keyMeta.isSigner ||= accountMeta.isSigner**
  <a id='troubleshooting-account-meta-signer'></a>

  ```
  SyntaxError: Unexpected token '='
  ```

  This is likely caused by an outdated version of Node.js on the machine.

  **Solution:**

  Upgrade Node.js to version 16 or later.

- **Segmentation fault (core dumped)**<a id='troubleshooting-segmentation-fault'></a>

  This could be caused by the system containing two different versions of Node.js,
  one installed at the system level (e.g., via `apt`) and the other installed via `npm`.

  **Solution:**

  Remove Node.js from the system and use the version from `npm`. For `apt`, use the following commands:

  ```sh
  sudo apt remove nodejs
  sudo apt autoremove
  node --version
  ```

- **DeprecationWarning: The punycode module is deprecated. Please use a userland alternative instead.**
  <a id='troubleshooting-deprecation-punycode'></a>

  **Explanation**

  This is an issue with the core Typescript dependency solana-web3.js (https://github.com/solana-labs/solana-web3.js/issues/2781).
  The CLI is awaiting the official release of a new major version of the web3.js
  library that fixes this flaw.

  **Solution**

  No functionality issue. The CLI can be used as is with this warning displayed.

- **WithdrawRequestNotReady ... Withdraw request has not elapsed the epoch lockup period yet.**
  <a id='troubleshooting-withdraw-not-ready'></a>

  ```
  "Program log: AnchorError caused by account: withdraw_request. Error Code: WithdrawRequestNotReady. Error Number: 6021. Error Message: Withdraw request has not elapsed the epoch lockup period yet."
  ```

  **Explanation**

  This error occurs with the `claim-withdraw-request` CLI command and means that the withdrawal request is not yet ready.
  The bonds program allows funds to be withdrawn only after a specified time defined in the `Config` account.
  Wait for a few `epochs` for the request to become available for claiming.
  More information can be found in the [Withdrawing Bond Account](#withdrawing-bond-account) section.

- **Error processing Instruction 0: custom program error: 0xbbd**
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

- **Failed to claim withdraw request ...\***
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

- **Transaction simulation failed: Attempt to debit an account but found no record of a prior credit.**
  <a id='troubleshooting-attempt-debit'></a>

  The executed command sends the transaction on-chain. For the transaction to be processed, a wallet must pay
  the [transaction fee](https://solana.com/docs/core/fees) (approximately 5000 lamports).
  The CLI attempts to use the default wallet payer, which is typically the default Solana CLI keypair
  (usually located at `$HOME/.config/solana/id.json`; see CLI configuration with `solana config get`).
  If this wallet address has insufficient funds to cover the transaction fee, you will encounter this error.

  To verify which keypair is being used, add the `--verbose` switch to your command.

  **Solution:**

  Use the `-k <keypair-path>` parameter to specify a keypair wallet that has sufficient lamports to pay the transaction fee.
