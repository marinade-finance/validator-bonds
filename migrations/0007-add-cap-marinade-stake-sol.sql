-- Track the marinadeStakeSol value at the limiting cap constraint so that
-- cap_changed events can emit the numeric previous vs current cap in SOL.
-- AuctionConstraint.marinadeStakeSol is what the ds-sam SDK reports for the
-- limiting constraint (previously `ASO`, `BOND`, etc.) at the time the cap
-- was decided.
ALTER TABLE bond_event_state
    ADD COLUMN IF NOT EXISTS cap_marinade_stake_sol DOUBLE PRECISION;
