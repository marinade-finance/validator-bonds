# On-chain transaction analysis

To check the historical data of the Validator Bonds program processing
we present here a analysis queries to [FlipSide Crypto](https://flipsidecrypto.xyz/)
that bring the insight of the on-chain data processing.

For details on available tables for Solana transactions table see
[core__fact_transactions view](https://flipsidecrypto.github.io/solana-models/#!/model/model.solana_models.core__fact_transactions).


## Query Validator Bonds Fund instructions

### Fund Bond

Query that provides a list of Fund Bond transactions, showing the stake account funded into
the Bond contract and the stake account balance at the time the transaction was completed.

```sql
with
  fund_ixs as (
    select
      tx_id,
      -- https://github.com/marinade-finance/validator-bonds/blob/main/programs/validator-bonds/src/instructions/bond/fund_bond.rs#L48 - 4th account in ix, index 3
      ixs.value:accounts[3] stake_account,
      ixs.value:accounts[1] bond_account,
      ixs.value:data ix_data,
      account_keys,
      post_balances,
      block_timestamp,
      block_id
    from solana.core.fact_transactions,
      LATERAL FLATTEN(input => instructions) ixs,
    where 1=1
      and BLOCK_TIMESTAMP > CURRENT_DATE - 7
      -- and BLOCK_TIMESTAMP <= CURRENT_DATE - 7
      and ixs.value:programId = 'vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4'
      -- FundBond Anchor IX discriminator: '[58, 44, 212, 175, 30, 17, 68, 62]'
      -- base58: AjNYrvLyYzh
      and ixs.value:data = 'AjNYrvLyYzh'
      and bond_account = '<<bond-account-pubkey>>'
  )
select
  block_timestamp,
  block_id,
  tx_id,
  stake_account,
  bond_account,
  post_balances[accounts.index] / 1e9 balance,
  ix_data
from
  fund_ixs,
  LATERAL FLATTEN(input => account_keys) accounts
WHERE 1=1
  and stake_account = accounts.value:pubkey
ORDER BY block_timestamp  ASC
```

### Fund Settlement

Query that provides a list of Fund Settlement transactions, showing the stake account funded
into the Settlement contract and the split stake account that remained within the Bond program.

```sql
with
  fund_ixs as (
    select
      tx_id,
      -- fund_settlement ix was changed from epoch 679 and stake is at index 5 instead of 4 as before
      -- https://github.com/marinade-finance/validator-bonds/blob/main/programs/validator-bonds/src/instructions/settlement/fund_settlement.rs - 5th account in ix, index 4
      CASE
           WHEN BLOCK_ID >= 293328000
          THEN 5
        ELSE 4
      END AS stake_account_idx,
      CASE
           WHEN BLOCK_ID >= 293328000
          THEN 8
        ELSE 7
      END AS split_stake_account_idx,
      ixs.value:accounts[stake_account_idx] stake_account,
      ixs.value:accounts[split_stake_account_idx] split_stake_account,
      ixs.value:accounts[1] bond_account,
      ixs.value:data ix_data,
      account_keys,
      post_balances,
      pre_balances,
      block_timestamp,
      block_id
    from solana.core.fact_transactions,
      LATERAL FLATTEN(input => instructions) ixs,
    where 1=1
      and BLOCK_ID >= 298080000
      and bond_account = '<<bond-account-pubkey>>'
      and ixs.value:programId = 'vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4'
      -- FundSettlement Anchor IX discriminator: '[179, 146, 113, 34, 30, 92, 26, 19]'
      -- base58: X35Gz7Wk1Y6
      and ixs.value:data = 'X35Gz7Wk1Y6'
  )
select
  floor(block_id / 432000) AS epoch,
  block_timestamp,
  block_id,
  tx_id,
  stake_account,
  split_stake_account,
  bond_account,
  -- filtering by stake_account to accounts.value:pubkey and the .index is the stake account post balance
  post_balances[accounts.index] / 1e9 funded_amount,
  ix_data
from
  fund_ixs,
  LATERAL FLATTEN(input => account_keys) accounts
WHERE 1=1
  and stake_account = accounts.value:pubkey
ORDER BY floor(block_id/432000) ASC
```

## Query Validator Bonds instructions event data

One can query the Anchor instructions for events as they are emitted in the contract code,
see e.g., [FundBond event](https://github.com/marinade-finance/validator-bonds/blob/contract-v2.0.0/programs/validator-bonds/src/instructions/bond/fund_bond.rs#L127).

```sql
SELECT
  -- floor(block_id/432000) as epoch,
  -- tx_id,
  block_timestamp,
  block_id,
  ixs.value:data
FROM solana.core.fact_events fe
INNER JOIN
  solana.core.fact_transactions ft USING(block_timestamp, tx_id, succeeded),
  LATERAL FLATTEN(input => fe.inner_instruction:instructions) ixs
WHERE fe.succeeded
-- and fe.block_id >= 700*432000
and fe.program_id = 'vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4'

-- Type of INSTRUCTION searching for
-- and array_contains('Program log: Instruction: FundBond'::variant, ft.log_messages)
and array_contains('Program log: Instruction: FundSettlement'::variant, ft.log_messages)
-- and array_contains('Program log: Instruction: ClaimWithdrawRequest'::variant, ft.log_messages)

-- filter instructions by Bond pubkey
and array_contains('<<bond-account-pubkey>>'::variant, fe.instruction:accounts)

-- from the list of inner instructions getting only those that contains the CPI event data
-- the CPI PDA call address is always the same for bond program
and array_contains('j6cZKhHTFuWsiCgPT5wriQpZWqWWUSQqjDJ8S2YDvDL'::variant, ixs.value:accounts)
order by block_timestamp ASC;
```

### Investigate the event data

The string found in the `ixs.value:data` column can be decrypted using the
[Validator Bonds CLI](../../packages/validator-bonds-cli/README.md)
`show-event` command.

Run it like this:

```sh
pnpm --silent cli show-event -f json <<base58-format-cpi-event-data>>
```

or one can use the script [`parse-flipside-event-csv`](../../scripts/parse-flipside-event-csv.sh).
See following guideline:

1. Run the FlipSide query with Bond account defined within
   https://flipsidecrypto.xyz/studio/queries
2. Download the `Results` CSV file
   ![Download the `Results` CSV file](../../resources/onchain/howto-download-results.png)
3. Get running the parsing script to list the funded amounts per transaction
   ```
   ./scripts/parse-flipside-event-csv.sh ~/Downloads/download-query-results-37ee1ecb-3e1b-438d-b410-5a1d617ccbe3.csv 
   ./scripts/parse-flipside-event-csv.sh: parsing file 'Downloads/download-query-results-37ee1ecb-3e1b-438d-b410-5a1d617ccbe3.csv'
   Skipping 'BLOCK_TIMESTAMP'
   2024-11-1600:13:35.000;698;7.335386511
   2024-11-1722:27:48.000;699;0.501340858
   2024-11-1722:59:21.000;699;17.833468698
   2024-11-2008:40:44.000;700;9.445008408
   Total lamports: 35.115204475
   ```