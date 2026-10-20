-- Per-validator calc blob relayed to the CLI (ds-sam-calc), from the auction
-- bonds-eventing runs.
ALTER TABLE bond_event_state
    ADD COLUMN IF NOT EXISTS auction_validator JSONB;

-- Auction-wide context (winningTotalPmpe, TVL, DsSamConfig scalars, blacklist):
-- one row per bond_type, overwritten each eventing run.
CREATE TABLE IF NOT EXISTS bond_event_meta (
    bond_type TEXT PRIMARY KEY,
    epoch INTEGER NOT NULL,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
