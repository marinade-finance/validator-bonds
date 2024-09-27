# On-chain transaction analysis

To check the historical data of the Validator Bonds program processing
we present here a analysis queries to [FlipSide Crypto](https://flipsidecrypto.xyz/)
that bring the insight of the on-chain data processing.

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
```

### Fund Settlement

Query that provides a list of Fund Settlement transactions, showing the stake account funded
into the Settlement contract and the split stake account that remained within the Bond program.

```sql
with
  fund_ixs as (
    select
      tx_id,
      -- https://github.com/marinade-finance/validator-bonds/blob/main/programs/validator-bonds/src/instructions/settlement/fund_settlement.rs - 5th account in ix, index 4
      ixs.value:accounts[4] stake_account,
      ixs.value:accounts[7] split_stake_account,
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
      and BLOCK_TIMESTAMP > CURRENT_DATE - 2
      -- and BLOCK_TIMESTAMP <= CURRENT_DATE - 7
      and ixs.value:programId = 'vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4'
      -- FundSettlement Anchor IX discriminator: '[179, 146, 113, 34, 30, 92, 26, 19]'
      -- base58: X35Gz7Wk1Y6
      and ixs.value:data = 'X35Gz7Wk1Y6'
      and bond_account = '<<bond-account-pubkey>>'
  )
select
  block_timestamp,
  block_id,
  tx_id,
  stake_account,
  split_stake_account,
  bond_account,
  pre_balances[accounts.index] / 1e9 pre_balance,
  post_balances[accounts.index] / 1e9 post_balance,
  ix_data
from
  fund_ixs,
  LATERAL FLATTEN(input => account_keys) accounts
WHERE 1=1
  and stake_account = accounts.value:pubkey
```


## Query Validator Bonds instructions event data

One can query the Anchor instructions for events as they are emitted in the contract code,
see e.g., [FundBond event](https://github.com/marinade-finance/validator-bonds/blob/contract-v2.0.0/programs/validator-bonds/src/instructions/bond/fund_bond.rs#L127).

```sql
select block_timestamp, ixs.value:data
    from solana.core.fact_events fe
    inner JOIN solana.core.fact_transactions ft USING(block_timestamp, tx_id, succeeded)
        ,LATERAL FLATTEN(input => fe.inner_instruction:instructions) ixs,
where 1=1
    and fe.succeeded
    and fe.program_id = 'vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4'
    and fe.block_timestamp > current_date - 7
    -- and fe.block_timestamp < current_date - 7
    and array_contains('Program log: Instruction: FundBond'::variant, ft.log_messages)
    and array_contains('<<bond-account-pubkey>>'::variant, fe.instruction:accounts)
    -- filter the list of inner instructions for only the emit log CPI events
    -- this instruction is always emitted by the same Anchor CPI PDA defined for the bond program
    and array_contains('j6cZKhHTFuWsiCgPT5wriQpZWqWWUSQqjDJ8S2YDvDL'::variant, ixs.value:accounts)
order by block_timestamp ASC;
```

"The string found in the `ixs.value:data` column can be decrypted using the
[Validator Bonds CLI](../../packages/validator-bonds-cli/README.md)
`show-event` command.

Run it like this:

```sh
pnpm --silent cli show-event -f json <<base58-format-cpi-event-data>>
```