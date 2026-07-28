-- Remaining settlement claim lamports per bond (bonds API `remainining_settlement_claim_amount`).
-- Lets settlement_applied compare true settlement charges instead of the conflated
-- funded - effective difference (which also includes pending withdraw requests).
-- NULL = unknown (bidding rows; ds-sam does not expose the split).
ALTER TABLE bond_event_state
    ADD COLUMN IF NOT EXISTS settlement_claims_lamports BIGINT;
