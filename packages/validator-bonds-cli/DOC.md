# Stake Auction Market (SAM)

--> TODO: what about removing the sentence "On August 14th ...." ?

### Quick Overview

Delegation is unified under the Stake Auction Marketplace (SAM):

- **Stake Auction Marketplace (100% of TVL)**: Marinade’s entire TVL is distributed exclusively through SAM.

Every epoch, Marinade evaluates the performance of validators in SAM, gathers MNDE votes, and rebalances stake based on these results. This process operates in a publicly accessible pipeline available on [GitHub](https://github.com/marinade-finance/ds-sam-pipeline), where previous scoring runs can also be viewed.

Marinade evaluates **all active validators that have set up their PSR bond.** The code computing stake distribution is available online, and the results are published on-chain.
You can view validator details on Marinade's [Validator Dashboard](https://marinade.finance/validators/).

The ethos is to be transparent and open to all validators.

### Stake Auction Marketplace

The Stake Auction Marketplace allows Marinade stakers to delegate SOL to validators offering the best APY. Validators are scored based on their "**`max_yield`"** (maximum yield for stakers at a specific stake level, e.g., 8% APY on 100k SOL).

Every epoch, Marinade ranks validators based on "`max_yield"` (which includes their commission and bid) and distributes stake to the highest-yielding validators, ensuring adherence to eligibility criteria and decentralization constraints.

#### **Benefits for Validators**:

- **Customized Commission**: Validators can share rewards with Marinade stakers through two flexible bidding methods: Static bid (CPMPE) - a fixed cost per 1,000 SOL delegated per epoch, paid from the validator's bond; and Dynamic commission bid - share a percentage of rewards (inflation, MEV, or block rewards) by setting commission rates as a percentage of your on-chain commission using basis points (e.g., 500 bps = 5%). These methods can be used individually or combined, allowing validators to customize their reward sharing with stakers without affecting their public commission rate for external stakers.
- **Revenue Sharing**: Validators can share revenue sources directly with Marinade stakers through their bidding strategy, whether via static bids or dynamic commission sharing.
- **Last Price Auction**: Validators set the maximum bid they're willing to pay without needing to monitor bids every epoch. At the end of each epoch, static bids are charged at the realized_yield (max_yield of the last validator to receive stake), which may be lower than the maximum bid set. Dynamic commission bids are charged based on actual rewards earned.

#### Last price auction

At the end of the scoring process, Marinade has a list of validators ordered by max_yield, as well as an amount of stake to be distributed to each validator.

The "realized_yield" for the epoch will be set to the "max_yield" of the last validator to receive stake, which is consequently the lowest yield of the list.

Validators that had a higher "max_yield" for that epoch will not provide their full "max_yield" but will only need to provide the "realized_yield" for the epoch. However, the charging mechanism differs based on the bidding method used:

For static bids (CPMPE): The bid is charged based on the "realized_yield" and the amount of delegated stake. This means the bid might get charged less than the maximum that was set, as a lower amount of SOL would be needed to achieve the lower "realized_yield", unless they are the last validator from the list.

For dynamic commission bids: The charge is calculated separately based on the actual rewards earned by the validator during the epoch. Marinade considers the lower value between the on-chain commission and the configured commission in the validator's bond. For example, if a validator has 5% commission on-chain but configured 3% in their bond, stakers receive 97% of rewards (the additional 2% beyond the 95% already distributed on-chain by Solana). Marinade then charges this 2% difference from the validator's bond based on the actual rewards earned in that epoch.

This dual mechanism prevents validators from overpaying on static bids (which get charged at the realized_yield level) while ensuring transparent reward sharing through dynamic commissions (charged on actual performance). Both charges are cumulative and applied independently based on the validator's bidding configuration.

**Example of max_yield vs. realized_yield:**

<table data-header-hidden><thead><tr><th width="120"></th><th width="150"></th><th width="145"></th><th></th></tr></thead><tbody><tr><td>Validator ID</td><td>max_yield (APY)</td><td>stake_received (SOL)</td><td>realized_yield (APY)</td></tr><tr><td>1</td><td>10.6%</td><td>95 000</td><td>8.12%</td></tr><tr><td>2</td><td>9.58%</td><td>200 000*</td><td>8.12%</td></tr><tr><td>3</td><td>9.4%</td><td>80 000</td><td>8.12%</td></tr><tr><td>…</td><td>…</td><td>…</td><td>…</td></tr><tr><td>166</td><td>8.12%</td><td>15 000**</td><td>8.12%</td></tr><tr><td>167</td><td>8.12%</td><td>15 000**</td><td>8.12%</td></tr><tr><td>168</td><td>8.10%</td><td>0</td><td>0%</td></tr></tbody></table>

In the example above, Marinade would distribute stake to a total of 168 validators.

Let's imagine that the validator ranked 1 has a base APY of 7.6%, and has set a static bid (CPMPE) that pushes his max_yield to 10.6%.

In that epoch, Validator 1 would not spend his full "CPMPE" to achieve a 10.6% yield, but their bond would only get charged enough SOL to arrive at an 8.12% APY. This will be the case for all validators that provide a max_yield that is higher than 8.12% APY.

Alternatively, if the validator ranked 167 in that example had a base APY of 7.6%, and a static bid to push his max_yield to 8.12% APY, this validator would be paying their full static bid (CPMPE) for that epoch.

This mechanism ensures that validators can set their true max_yield without worrying about overpaying for stake at any given point.

### How to participate in the Stake Auction Marketplace

Any validator can participate in the Stake Auction Marketplace.

To participate, a validator must:

- **Create a PSR bond** associated with its validator, using the [validators bond CLI](https://www.npmjs.com/package/@marinade.finance/validator-bonds-cli?activeTab=readme) (see [Readme](https://github.com/marinade-finance/validator-bonds/tree/main/packages/validator-bonds-cli))
- **Set a bid** using one or both methods: **Static bid (CPMPE)** in lamports (Cost per mile per epoch, corresponding to the maximum bid that the validator is willing to pay to receive 1000 SOL delegated for an epoch), and/or **Dynamic commission bid** as a percentage of on-chain commission using basis points (e.g., 500 bps = 5% of inflation, MEV, or block rewards)
- **Ensure sufficient bond funding** to cover the stake and bid amount. A [calculator](https://docs.google.com/spreadsheets/d/10p5vjJo6ncMns_baGpokWjfG3Bk1iduLtGn3-vjNUDw/edit?usp=sharing) is available to help estimate the SOL needed in the bond.

A simulation is running on <https://psr.marinade.finance/> where validators can see how the bid they set would impact the stake distribution. More instructions to participate in that simulation are available [here](https://marinade.notion.site/SAM-Dry-Run-Instructions-d34eb7781cb245388a0acfae7f31b8e1).

{% hint style="info" %}
Reminder: \
\- SOL deposited in a validator's bond will always stay delegated to that validator and can be considered as self-stake. \
\- Always use the [Validator bonds CLI](https://github.com/marinade-finance/validator-bonds/tree/main/packages/validator-bonds-cli#funding-bond-account**) to add or withdraw SOL from your validator's bond.
{% endhint %}

### Bonds Settlements

At the start of each epoch (Epoch N+1), Marinade settles bids from validators who received activated stake in the previous epoch. The results are publicly available in the [GitHub repository](https://github.com/marinade-finance/ds-sam-pipeline/tree/main/auctions).

**Bonds Calculation Formula** (for validators receiving SAM stake):

**Bid Charged** = **Static Bid** + **Dynamic Commission Bid** = `(Active stake from Marinade at end of epoch * Effective Bid) / 1000 + (Total Rewards Earned from Marinade Stakers * Commission Rate)`

The `Commission Rate` is taken separately for inflation rewards, MEV rewards, and block rewards, based on the lower value
between the on-chain commission and the configured commission in the validator's bond.

{% hint style="info" %}
The settlement created for a given epoch can contain extra SOL from the bond, allowing Marinade to enforce the minimum of 1 SOL per stake account. Any additional SOL in the settlement that is not used to pay for stake in that epoch will go back to the bond once the settlement expires after 3 epochs.
{% endhint %}

---

### `maxStakeWanted` Parameter

The `maxStakeWanted` parameter defines the **maximum amount of Marinade stake (in SOL)** that a validator **wants** to receive through the Stake Auction Marketplace (SAM). This is a **cap**, not a guarantee. Validators must still place competitive bids and win stake through the auction process.

This setting gives validators more control over how much stake they want from Marinade. If you want to limit the amount of stake you receive through SAM, you **must explicitly set `maxStakeWanted`**. If it is left unset (`0` or undefined), Marinade treats it as **no cap**, meaning you may receive any amount of stake based on your bond size and how competitive your bid is. Even when `maxStakeWanted` is set, it only affects **new stake** considered for delegation. It does **not remove** any stake that has already been delegated to you. You will **still pay for all the stake you currently hold**, regardless of your `max_stake_wanted` setting.

**If you do not want to receive any stake from Marinade at all**, simply setting `maxStakeWanted` to zero is not enough. You must **fully withdraw your validator bond**. Remaining bonded means you will continue to participate in auctions and may receive stake if your bid wins.

#### **How It Works**

- Marinade enforces the `maxStakeWanted` cap during each auction cycle
- You must still win stake by placing a competitive bid and maintaining an active validator bond
- If your existing delegated stake is already equal to or above the cap, no additional stake will be delegated to you

#### **Examples**

**Example 1 – Capped growth:**

- If a validator sets `maxStakeWanted` to `25,000 SOL` and already has `22,000 SOL` delegated from Marinade:
  - Even if they have enough SOL in their validator bond, place a competitive bid, and are otherwise eligible for more stake, Marinade will only delegate **up to 3,000 SOL more**
  - This is because the `maxStakeWanted` parameter caps the total Marinade stake the validator wants to receive

**Example 2 – Cap below current stake:**

- If a validator currently has `40,000 SOL` delegated from Marinade and later sets `maxStakeWanted` to `30,000 SOL`:
  - Marinade **will not remove** the extra 10,000 SOL immediately
  - The `maxStakeWanted` cap only applies to **new stake**, so the validator will continue paying for the full 40,000 SOL unless action is taken
  - To reduce stake over time, the validator can:
    - Lower their bid so they become less competitive
    - Withdraw some of their bond to reduce stake capacity
    - Wait for other validators to outbid them, causing stake to be reallocated over several epochs

#### **Disabling the Cap**

--> TODO: should not we rather say to set the `max_stake_wanted` to `0` to be consistent to the doc above?

To effectively disable the limit and ensure you are not capped as Marinade’s TVL grows, set `max_stake_wanted` to a very high value like **1 billion SOL**, or use a large lamport equivalent such as `1e18` or `18e18`.

---

### Stake Matching

To support a broader set of validators and make participation in Marinade’s Stake Auction Marketplace (SAM) more accessible, Marinade offers **stake matching** for validators who attract external stake.

#### What is Stake Matching?

If a validator brings in external (non-self) stake, Marinade may match **10% to 30%** of that amount with its own delegation. The matched portion **does not require a bond**, making it easier for validators to earn Marinade stake without locking up additional capital.

#### How It Works

- **Matching range:** 10% to 30% of eligible external stake
- **No bond needed:** Only upcoming bid epochs need to be covered
- **Auction requirement:** Validators must still **win stake through the auction** to receive both direct and matched stake
- **Per-validator cap:** Up to **0.4% of Marinade’s total TVL in SOL** can be matched per validator
- **Program scale:** Stake matching scales dynamically with participation and available stake. There is no fixed cap.

**Example:**\
With 10 million SOL in TVL, a validator can receive up to 40,000 SOL in matched stake.

#### Why It Matters

- Reduces the capital barrier for gaining stake
- Makes SAM more accessible to validators
- Helps maintain a diverse and high-performing validator set
- Supports Marinade’s goal of delivering **the best yield on Solana**

---

### Bid Reduction Penalty

Validators receiving stake should not lower their CPMPE to retain stake for more epochs while not paying the initial bid that allowed them to acquire that stake in the first place. This behaviour creates inefficiencies and forces Marinade to rebalance stake, reducing the stakers' APY. \
\
To prevent that behaviour, Marinade installed a Bid-Reduction Penalty. If a validator reduces its bid after receiving stake from the auction using a higher bid, it will pay a penalty from its bond. The penalty is calculated according to the following formula:

```
limit = min(effBid, effBid[-1], effBid[-2], effBid[-3])
penaltyCoef = min(1, sqrt(1.5 * max(0, limit - bidCpmpe) / limit)
penaltyPmpe = winningTotalPmpe + effBid
penalty = penaltyCoef * penaltyPmpe * marinadeActivatedStakeSol / 1000
```

Where:

`effBid[-i]` is the `effBid` of the auction `i` epoch in the past,

`winningTotalPmpe` is the auction winning pmpe for a 0-commission validator, including the bid, inflation and MEV rewards,

`marinadeActivatedStakeSol` is the active delegated stake on this validator,

`effBid` is the bid derived from the auction-winning APY that this validator would pay if he remains part of the winning set.

If the validator did not lower his bid, no penalty is paid. If the validator lowers his bid, he pays a full penalty according to the formula above.

{% hint style="warning" %}
⚠️ **Important Clarification**: Paying the penalty does **not** entitle the validator to keep the stake.\
Validators who deliberately lower their bid to reduce payment obligations, even if they pay the associated penalty, **will be unstaked**. These validators should not have retained the stake in the first place under fair auction conditions.

Marinade’s system will actively rebalance such stake allocations to protect the protocol and uphold fairness for both validators and stakers.
{% endhint %}

#### **Example A - Validator lowers its bid to 0**

- Validator receives 100k SOL from Marinade, with 0% commission on MEV and inflation, and a CPMPE set at 0.15
- The validator lowers his bid to 0 on Epoch N
- Effective Bid for the past 3 epochs and current epoch is 0.1 (for a 0-commission validator)
- WinningTotalPmpe for the current epoch is 0.60 SOL

limit = min(0.1,0.1,0.1,0.1), so limit is 0.1 \
PenaltyCoef = min( 1, sqrt(1.5 \* max (0, 0.1 - 0) /0.1), so PenaltyCoef is 1\
PenaltyPmpe = 0.60 + 0.1, so PenaltyPmpe is 0.70\
Penalty = 1\*0.7\*100000/1000, so the Penalty is 70 SOL.

#### **Example B - Validator lowers its bid to 0.075**

- Validator receives 100k SOL from Marinade, with 0% commission on MEV and inflation, and a CPMPE set at 0.15
- The validator lowers his bid to 0.075 on Epoch N
- Effective Bid for the past 3 epochs and current epoch is 0.1 (for a 0-commission validator)
- WinningTotalPmpe for the current epoch is 0.60 SOL

limit = min(0.1,0.1,0.1,0.1), so limit is 0.1 \
PenaltyCoef = min( 1, sqrt(1.5 \* max (0, 0.1 -0.075) /0.1), so PenaltyCoef is 0.61237243569\
PenaltyPmpe = 0.60 + 0.1, so PenaltyPmpe is 0.70\
Penalty = 0.61237243569\*0.7\*100000/1000, so the Penalty is 42.8660704983 SOL.

#### **Example C - Validator does not lower its bid but request a withdraw from their bond**

- Validator receives 100k SOL from Marinade, with 0% commission on MEV and inflation, and a CPMPE set at 0.15
- The validator conserves his bid from Epoch N-3 to Epoch N where bond is withdrawn
- Effective Bid for the past 3 epochs and current epoch is 0.1 (for a 0-commission validator)
- WinningTotalPmpe for the current epoch is 0.60 SOL

limit = min(0.1,0.1,0.1,0.1), so limit is 0.1 \
PenaltyCoef = min( 1, sqrt(1.5 \* max (0, 0.1 -0.1) /0.1), so PenaltyCoef is 0\
PenaltyPmpe = 0.60 + 0.1, so PenaltyPmpe is 0.70\
Penalty = 0\*0.7\*100000/1000, so the Penalty is 0 SOL.

After a few epochs, the validator can withdraw its bond and exit the auction without paying any penalty.

---

### Stake Distribution Ordering and Decentralization Constraints

#### **Unstaking priority rules**

An unstake priority is attributed to all validators:

- **Ineligible Validators:**
  - Validators that do not meet the eligibility criteria are assigned a priority of **0**.
- **Partially Covered Stake:**
  - Validators with a portion of their current stake not covered by their bond are assigned a priority ranging from **1 to N**, depending on the percentage of stake that remains uncovered.
- **Overstaked Validators:**
  - Validators that are overstaked are assigned a priority from **N+1 to M**, based on the percentage of their stake from Marinade that is overstaked.

#### Unstaking Process:

- Marinade initiates the unstaking process starting with priority **0** and progresses in ascending order (1, 2, ..., M).
- The process continues until the **5% cap** of stake that can be rebalanced per epoch is reached.

#### **Stake Allocation:**

Marinade’s stake distribution operates through a unified pipeline that integrates MNDE-directed votes and SAM bids, collectively allocating the entire TVL.

**Distribution Mechanics:**

- **Priority-Based Distribution:** Stake is allocated starting from the highest-ranked validator down the list.
- **Constraint Checks:** For each validator, the following constraints are verified before allocating stake:
  - **Validator TVL Constraint:**
    - Validators who do not have MNDE-Enhanced Stake directed to them are limited to a **default stake cap of 4%** of Marinade’s TVL. However, validators with MNDE-directed stake can increase this cap, allowing them to receive additional stake from the auction. (This mechanism helps prevent sybil attacks by ensuring only validators with genuine support through MNDE can exceed the standard cap.)
  - **ASO/Country Constraints:**
    - Ensures that staking to a validator does not exceed Solana's **30%** concentration for ASO and **30%** for Country.
  - **Bond Balance:**
    - Verifies that the validator’s bond balance is sufficient to cover downtime (PSR) and at least one epoch's worth of effective yield, including the bid.

**Stake Allocation Process:**

- **Sequential Allocation:** Stake is allocated to validators in order of their Max_Yield, subject to the above constraints.
- **Handling Ties:**
  - If two or more validators have the same Max_Yield, the remaining stake is split equally among them.
  - Constraint checks are performed in parallel to ensure fair distribution.
- **Completion:** The process continues until all available stake is distributed or no further allocations are possible due to constraints.
- **Result:** This process returns a **list of validators sorted by Max_Yield**, along with the **amount of stake each validator is allocated**.

**Priority Adjustment:**

- **Insufficient Allocation Scenario:**
  - If a validator's bid is too low or their bond has insufficient funds, they will receive less stake or no stake at all.
  - **Resolution:** Validators should keep their bond topped up to maintain the stake they already have. Those without stake yet should increase their bid to improve priority and secure stake allocation.

---

### Eligibility Criteria to Receive Stake From Marinade

#### **For the Stake Auction Marketplace:**

- Validator is not blacklisted (running harmful mods, commission rugs)
- Validator runs a version of the node that is in the specified semver bounds.
- Validator's final inflation commission is ≤ 7 % (bids and MEV commission can be used to offset a higher public commission.)
- Validator's uptime was> 80% in each of the last 3 epochs, calculated using the stake-weighted average of vote credits.
- Validator has created and funded its [PSR bond](https://marinade.finance/blog/psr-and-delegation-strategy-updates/). The PSR bond must contain enough SOL for:
  - One epoch of downtime (1 SOL per 10k SOL)
  - One epoch of "Maximum_yield" for the epoch for the amount of stake received (set by the validator)
  - One epoch of bids (set by the validator)

This [calculator](https://docs.google.com/spreadsheets/d/10p5vjJo6ncMns_baGpokWjfG3Bk1iduLtGn3-vjNUDw/edit?usp=sharing) can be used to estimate the bond size required for a given amount of stake.

#### **For MNDE votes:**

All the constraints above apply, with those slight differences:

- Bids are **charged** for the stake distributed through MNDE, meaning that MNDE-directed stake increases the cap and is charged accordingly.
- A PSR bond remains necessary to protect against downtime and safeguard the yield for the MNDE-distributed stake.

---

### How to Exit the Stake Auction Marketplace

If you start receiving stake from SAM, please note that **the only correct way to exit the marketplace is to request a withdraw from your bond.** This allows Marinade to re-delegate stake from you, and you will not be charged for this action.

If you receive stake from SAM but lower your CPMPE, **Marinade will create a bond settlement for the expected yield that will be missed** (see Bid Reduction Penalty).

---

### Blacklist Policy

The **Marinade Foundation** mandates **Marinade Labs** to use a proprietary methodology to determine which validators may be blacklisted from the Marinade Stake Auction Marketplace. Blacklisting is a last resort and is enforced only in clearly defined, verifiable cases, based on objective data and reproducible metrics.

#### General Principles

- Validators that **harm the network** may be subject to blacklisting.
- The blacklist is **updated continuously** by Marinade Labs, without prior notice, based on criteria set forth by the Marinade Foundation.
- The Marinade Foundation may **update blacklisting criteria at any time**, but in non-trivial cases, will do so **only with broad community consensus** and in support of Solana’s long-term health.

#### Grounds for Blacklisting

A validator may be blacklisted for:

- Engaging in **MEV sandwich attacks** in over 30% of blocks they produce.
- Intentionally introducing **latency** or degrading **network bandwidth**.
- **Slow voting** (also known as vote lagging).
- **Commission rugs**.
- Failing to **restart their node within 36 hours** after a cluster restart due to a halt, if it occurs at least twice.
- Any other form of **malicious MEV behavior**.

#### Consequences

- Blacklisted validators will be **excluded from Marinade delegation**.
- Where applicable, **validator bonds may be penalized**.

#### Removal from the Blacklist

- If blacklisting was **unjustified** (e.g., due to misinterpreted performance issues), the validator will be removed after review and approval.
- If rightfully blacklisted, a validator may be removed **only after reform and a minimum 1-month observation period**.
- **Repeat offenders** are **permanently blacklisted** and ineligible for Marinade stake. No appeals.
- Validators blacklisted for **commission rugs** are **permanently excluded**. No appeals.

---

### Technical details

- The delegation strategy scoring runs once per epoch.
- At the end of each epoch, Marinade's bot performs actions to move our stake distribution towards the desired state.
- Marinade uses ipwhois for geolocation services and data center identification. The data is updated every 24 hours.
- Marinade uses Solana on-chain data to collect all metrics about validators apart from geolocation
- Marinade has a public API: <https://validators-api.marinade.finance/docs>
- PSR bond also counts in the self-stake requirement of the [Solana Foundation Delegation Program ](https://solana.org/delegation-criteria#self-stake)(SFDP). Any SOL deposited in your bond will count towards your total self-stake.

---

### Useful resources

- PSR dashboard and simulation: <https://psr.marinade.finance/>
- MNDE calculator: <https://cogentcrypto.io/MNDECalculator>
- Directed stake dashboard: <https://lst-ds-dashboard.solanahub.app/>
- Bonds repository: <https://github.com/marinade-finance/validator-bonds>
- Bonds CLI package: [https://www.npmjs.com/package/@marinade.finance/validator-bonds-cli](https://www.npmjs.com/package/@marinade.finance/validator-bonds-cli?activeTab=readme)
- Google Bucket: <https://console.cloud.google.com/storage/browser/marinade-validator-bonds-mainnet/>
- GitHub:
  - <https://github.com/marinade-finance/psr-dashboard>
  - <https://github.com/marinade-finance/psr-sam>
  - <https://github.com/marinade-finance/psr-sam-pipeline>
