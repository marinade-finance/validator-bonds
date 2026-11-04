# fund_settlement model

TLA+ model of bond stake accounts, one settlement and the instructions that move lamports between them (`fund_bond`, `fund_settlement`, `claim_settlement_v2`, `close_settlement_v2`, `reset_stake`, `merge_stake`, `claim_withdraw_request`), with the stake program rules they rely on (inactive split clones the recorded stake, withdraw limited by the staked amount, delegate of an inactive account rewrites the stake). Lamports are small integers, live rent is below the pinned `Meta.rent_exempt_reserve`, and warmup and cooldown take one epoch.

`Fund = "current"` models the deployed instruction, `Fund = "new"` the planned fix. `WithdrawRequests` switches `claim_withdraw_request` on.

```
java -cp tla2tools.jar tlc2.TLC -workers auto -config current.cfg FundSettlement.tla
java -cp tla2tools.jar tlc2.TLC -workers auto -config new.cfg FundSettlement.tla
java -cp tla2tools.jar tlc2.TLC -workers auto -config new-withdraw-requests.cfg FundSettlement.tla
```

Expected results, each mirrored by a case of `packages/validator-bonds-sdk/__tests__/litesvm/fundSettlementMatrix.spec.ts`:

- `current.cfg` violates `NoPanic`: a bond account between the live-rent minimum and the minimal size panics at `fund_settlement.rs:200`. With size 3 removed it panics at `:233` on an account handed over underwater, and without `NoPanic` it violates `NoProgramMadeUnderwater` through the leftover cloned from an inactive source.
- `new.cfg` finds no error (about 36M distinct states, two minutes).
- `new-withdraw-requests.cfg` violates `NoProgramMadeUnderwater`: `claim_withdraw_request` splits an inactive bond account and the leftover kept by the bond inherits the full recorded stake.
