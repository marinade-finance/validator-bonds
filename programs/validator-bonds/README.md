# Validator Bonds On-Chain Program

## Workflow and on-chain data

![Solana Accounts used within the contract](./resources/diagram/accounts.png)

### Detailed description

1. The `Config` account is managed by the administrator.
   - The administrator configures the timeout for `WithdrawRequest`, and defines the time for availability to claim `Settlement`.
   - The administrator configures the `operator authority` and the `emergency pause authority`.
   - The operator authority manages the creation of settlements, funding settlements, and withdrawing non-delegated `StakeAccounts`.
   - The emergency pause authority may pause the contract with the `emergency pause` action.

2. The `Bond` account is created by validators and is strictly linked to a `VoteAccount`.
   - The `Bond` account may be created in either _permissioned_ mode or _permission-less_ mode.
     1. For _permissioned_ mode, the validator signs with their `validator identity` and configures the `bond authority`. The `bond authority` then has permission to make configuration changes and request fund withdrawals.
     2. For _permission-less_ mode, the bond account is created first, and additional operations are necessary to set up the `bond authority`.
   - Funding the `Bond` means depositing a [`StakeAccount`](https://github.com/solana-labs/solana/blob/v1.18.2/runtime/src/stake_account.rs#L19) under the Validator Bonds program.
     - To fund a [`StakeAccount`](https://github.com/solana-labs/solana/blob/v1.18.2/runtime/src/stake_account.rs#L19), it must be delegated (field [`node_pubkey`](https://github.com/solana-labs/solana/blob/v1.18.2/sdk/program/src/vote/state/mod.rs#L287)) to the same [`VoteAccount`](https://github.com/solana-labs/solana/blob/367f489f632d6be0fd93e95cc2c5b7202515fe6e/vote/src/vote_account.rs#L32) as the `Bond` was created with.
     - Upon funding the `StakeAccount`, withdrawer and staker authorities are [assigned under the program's PDA address](#stake-account-authorities-transitions).
     - The `Bond` is linked to one `VoteAccount`. The `StakeAccount` is delegated to a `VoteAccount`. The Validator Bond program never changes the delegation of the funded `StakeAccount`. The linking of the `StakeAccount` to `Bond` is done using the delegated `VoteAccount` pubkey from the `StakeAccount`.
     - The number of lamports credited to the `StakeAccount` is considered the funded amount for the `Bond`. The funded amount will likely increase over time (when no protected events occur) as the `StakeAccount` is delegated and earns Solana inflation rewards.

3. Withdrawing funded `Bond` is permitted to the validator, the owner of the `bond authority`.
   The withdrawal is delayed by a factor configured in `Config` as [`withdraw_lockup_epochs`](./programs/validator-bonds/src/state/config.rs#L17). The withdrawal process comes as a two-step process.
   1. Validator [initiates](./programs/validator-bonds/src/instructions/withdraw/init_withdraw_request.rs) a [`WithdrawRequest`](./programs/validator-bonds/src/state/withdraw_request.rs).
      - The withdraw request is created with the number of lamports that the validator plans to withdraw from the `Bond`.
      - ([The requested amount](./programs/validator-bonds/src/state/withdraw_request.rs#L17)) is no longer considered as funded.
   2. When the timeout of withdraw lockup epochs elapses, the validator may execute
      [`claim withdraw request operation`](./programs/validator-bonds/src/instructions/withdraw/claim_withdraw_request.rs)
      that brings withdrawer and staker authority back to the validator.
   - The `WithdrawRequest` can be [cancelled](./programs/validator-bonds/src/instructions/withdraw/cancel_withdraw_request.rs) (account deleted) at any time.

4. Operator authority creates a `Settlement` (represented by an on-chain account) when a protected event happens.
   The protected event is established for under-performing validators, usually once per epoch when network inflation rewards are distributed.
   The operator calculates losses against standard validator performance in the epoch; these losses are recorded in the form of a merkle tree
   per `VoteAccount`, and a `Settlement` with a merkle root is created on-chain. The merkle tree contains the list of creditors and their entitlements to the protected event.
   - Operator authority funds the `Settlement` with amount of lamports equal to the sum of losses recorded in the merkle tree.
      - The funding instruction assigns the bonds funded `StakeAccounts` under `Settlement` by assigning their staker authority
        under derived `Settlement's` staker PDA.
      - `StakeAccounts` funded to a `Settlement` cannot be used for withdrawing funded `Bond`
      - Funding `StakeAccount` to `Settlement` deactivates the `StakeAccount` to make it possible to withdraw the lamports
      - *Expectation:* To fully used the whole amount of lamports funded under the bond program by the validator
        the operator is required to merge all the `StakeAccounts` of the validator (delegated to the same `VoteAccount`)
        first and then fund such `StakeAccount` into `Settlement`. And the instruction is then capable to split `StakeAccount`
        with spill amount when needed.
   - The creditor may claim the calculated amount from the `Settlement`. A deduplication
      account, `SettlementClaim`, is created on-chain, referring to the fact that the protected event has already been claimed by the creditor.
   - The `Settlement` may be claimed only for a limited number of epochs, which is configured by the admin authority in `Config`.
     After the elapsed time, the `Settlement` can be closed, and nothing more can be claimed.
     - When the claim time availability elapses, the `Settlement` account can be closed, and the account rent is withdrawn.
   - The claiming instruction requires a `StakeAccount` that was funded under `Settlement`
     (withdrawer authority is Bonds withdrawer PDA, staker authority is Settlement staker PDA)
     and that has been waited for being deactivated. Then the lamports can be withdrawn into a destination
     `StakeAccount` which is determined by merkle tree creditor record.
     Intentionally the claim instruction does not check what [state](https://github.com/solana-labs/solana/blob/v1.18.2/sdk/program/src/stake/state.rs#L138) is the `StakeAccount` in.

5. There are few operations dedicated to `StakeAccount` management.
   - After closing the `Settlement` the un-claimed `StakeAccounts` may be
     - reset (in case of delegated ones); permission-less operation
     - withdrawn (in case of non-delegated in `Initialized` state ones); permissioned by operator authority
   - Any two `StakeAccounts` may be merged into single one when they consists of the same withdrawer authority,
     staker authority and they are both delegated to the same `VoteAccount`. Permission-less operation.


### Stake Account authorities transitions

**Invariant:**

- one `Bond` account per `VoteAccount`
- the Validator Bonds **never** changes the `StakeAccount` [delegation](https://github.com/solana-labs/solana/blob/master/sdk/program/src/stake/state.rs#L599) to any `VoteAccount`

**Derived addresses:**

- _Bonds withdrawer PDA_ is an address derived from `Config`
- _Settlement staker PDA_ is an address derived from `Settlement`

| Stake Account State                    | Withdrawer authority  | Staker authority      |
| -------------------------------------- | --------------------- | --------------------- |
| Owned by validator (not funded)        | _validator authority_ | _validator authority_ |
| Funded to bonds program                | Bonds withdrawer PDA  | Bonds withdrawer PDA  |
| Funded to settlement (protected event) | Bonds withdrawer PDA  | Settlement staker PDA |
| Reset (on settlement close)            | Bonds withdrawer PDA  | Bonds withdrawer PDA  |
| Settlement withdraw request claimed    | _validator authority_ | _validator authority_ |

### Security concerns

#### Operator authority has pretty much full control over the deposited funds

To mitigate the potential misuse of funds by a malicious operator, we implement the following measure:

The admin authority can utilize the `slots_to_start_settlement_claiming` option within the `Config` account to control when the claiming of settlements (i.e., withdrawing from settlements) may commence. This allows for the postponement of the claiming period for several slots after the settlement is created.

In the event that the operator authority's hot wallet key is compromised, the admin authority gains time until the `slots_to_start_settlement_claiming` period elapses to switch the operator authority to another wallet and manage the cancellation of any unauthorized settlements.

**IMPORTANT:** If the admin authority is held under a multisig or DAO management system, it must be positioned for immediate transaction execution to implement changes once all required signatures are obtained.

