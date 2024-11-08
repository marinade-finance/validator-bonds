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
          case
          WHEN BLOCK_ID >= 280800000 and BLOCK_ID <= 281231999 THEN 650
          WHEN BLOCK_ID >= 281232000 and BLOCK_ID <= 281663999 THEN 651
          WHEN BLOCK_ID >= 281664000 and BLOCK_ID <= 282095999 THEN 652
          WHEN BLOCK_ID >= 282096000 and BLOCK_ID <= 282527999 THEN 653
          WHEN BLOCK_ID >= 282528000 and BLOCK_ID <= 282959999 THEN 654
          WHEN BLOCK_ID >= 282960000 and BLOCK_ID <= 283391999 THEN 655
          WHEN BLOCK_ID >= 283392000 and BLOCK_ID <= 283823999 THEN 656
          WHEN BLOCK_ID >= 283824000 and BLOCK_ID <= 284255999 THEN 657
          WHEN BLOCK_ID >= 284256000 and BLOCK_ID <= 284687999 THEN 658
          WHEN BLOCK_ID >= 284688000 and BLOCK_ID <= 285119999 THEN 659
          WHEN BLOCK_ID >= 285120000 and BLOCK_ID <= 285551999 THEN 660
          WHEN BLOCK_ID >= 285552000 and BLOCK_ID <= 285983999 THEN 661
          WHEN BLOCK_ID >= 285984000 and BLOCK_ID <= 286415999 THEN 662
          WHEN BLOCK_ID >= 286416000 and BLOCK_ID <= 286847999 THEN 663
          WHEN BLOCK_ID >= 286848000 and BLOCK_ID <= 287279999 THEN 664
          WHEN BLOCK_ID >= 287280000 and BLOCK_ID <= 287711999 THEN 665
          WHEN BLOCK_ID >= 287712000 and BLOCK_ID <= 288143999 THEN 666
          WHEN BLOCK_ID >= 288144000 and BLOCK_ID <= 288575999 THEN 667
          WHEN BLOCK_ID >= 288576000 and BLOCK_ID <= 289007999 THEN 668
          WHEN BLOCK_ID >= 289008000 and BLOCK_ID <= 289439999 THEN 669
          WHEN BLOCK_ID >= 289440000 and BLOCK_ID <= 289871999 THEN 670
          WHEN BLOCK_ID >= 289872000 and BLOCK_ID <= 290303999 THEN 671
          WHEN BLOCK_ID >= 290304000 and BLOCK_ID <= 290735999 THEN 672
          WHEN BLOCK_ID >= 290736000 and BLOCK_ID <= 291167999 THEN 673
          WHEN BLOCK_ID >= 291168000 and BLOCK_ID <= 291599999 THEN 674
          WHEN BLOCK_ID >= 291600000 and BLOCK_ID <= 292031999 THEN 675
          WHEN BLOCK_ID >= 292032000 and BLOCK_ID <= 292463999 THEN 676
          WHEN BLOCK_ID >= 292464000 and BLOCK_ID <= 292895999 THEN 677
          WHEN BLOCK_ID >= 292896000 and BLOCK_ID <= 293327999 THEN 678
          WHEN BLOCK_ID >= 293328000 and BLOCK_ID <= 293759999 THEN 679
          WHEN BLOCK_ID >= 293760000 and BLOCK_ID <= 294191999 THEN 680
          WHEN BLOCK_ID >= 294192000 and BLOCK_ID <= 294623999 THEN 681
          WHEN BLOCK_ID >= 294624000 and BLOCK_ID <= 295055999 THEN 682
          WHEN BLOCK_ID >= 295056000 and BLOCK_ID <= 295487999 THEN 683
          WHEN BLOCK_ID >= 295488000 and BLOCK_ID <= 295919999 THEN 684
          WHEN BLOCK_ID >= 295920000 and BLOCK_ID <= 296351999 THEN 685
          WHEN BLOCK_ID >= 296352000 and BLOCK_ID <= 296783999 THEN 686
          WHEN BLOCK_ID >= 296784000 and BLOCK_ID <= 297215999 THEN 687
          WHEN BLOCK_ID >= 297216000 and BLOCK_ID <= 297647999 THEN 688
          WHEN BLOCK_ID >= 297648000 and BLOCK_ID <= 298079999 THEN 689
          WHEN BLOCK_ID >= 298080000 and BLOCK_ID <= 298511999 THEN 690
          WHEN BLOCK_ID >= 298512000 and BLOCK_ID <= 298943999 THEN 691
          WHEN BLOCK_ID >= 298944000 and BLOCK_ID <= 299375999 THEN 692
          WHEN BLOCK_ID >= 299376000 and BLOCK_ID <= 299807999 THEN 693
          WHEN BLOCK_ID >= 299808000 and BLOCK_ID <= 300239999 THEN 694
          WHEN BLOCK_ID >= 300240000 and BLOCK_ID <= 300671999 THEN 695
          WHEN BLOCK_ID >= 300672000 and BLOCK_ID <= 301103999 THEN 696
          WHEN BLOCK_ID >= 301104000 and BLOCK_ID <= 301535999 THEN 697
          WHEN BLOCK_ID >= 301536000 and BLOCK_ID <= 301967999 THEN 698
          WHEN BLOCK_ID >= 301968000 and BLOCK_ID <= 302399999 THEN 699
          ELSE 0 END AS epoch,
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
ORDER BY epoch ASC
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
ORDER BY block_timestamp ASC
```

```sql
-- FundSettlement
select block_timestamp, ixs.value:data
from solana.core.fact_events fe
inner JOIN solana.core.fact_transactions ft USING(block_timestamp, tx_id, succeeded)
  ,LATERAL FLATTEN(input => fe.inner_instruction:instructions) ixs,
where
fe.succeeded
and fe.program_id = 'vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4'
and array_contains('Program log: Instruction: FundSettlement'::variant, ft.log_messages)
-- vote account: CaraHZBReeNNYAJ326DFsvy41M2p1KWTEoBAwBL6bmWZ -> bond account: 3zVyxrxkR2a3oWoBku7CaAG7UW6JS65vqyoTdG1Djig9
and array_contains('3zVyxrxkR2a3oWoBku7CaAG7UW6JS65vqyoTdG1Djig9'::variant, fe.instruction:accounts)
-- from the list of inner instructions getting only those that contains the CPI event data
-- the CPI PDA call address is always the same for bond program
and array_contains('j6cZKhHTFuWsiCgPT5wriQpZWqWWUSQqjDJ8S2YDvDL'::variant, ixs.value:accounts)
ORDER BY block_timestamp ASC
```

The string found in the `ixs.value:data` column can be decrypted using the
[Validator Bonds CLI](../../packages/validator-bonds-cli/README.md)
`show-event` command.

Run it like this:

```sh
pnpm --silent cli show-event -f json <<base58-format-cpi-event-data>>
```