-- State snapshot for delta comparison (one row per validator per bond_type)
CREATE TABLE IF NOT EXISTS bond_event_state (
    vote_account TEXT NOT NULL,
    bond_pubkey TEXT,
    bond_type TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    in_auction BOOLEAN NOT NULL,
    bond_good_for_n_epochs DOUBLE PRECISION,
    cap_constraint TEXT,
    funded_amount_lamports BIGINT NOT NULL DEFAULT 0,
    effective_amount_lamports BIGINT NOT NULL DEFAULT 0,
    auction_stake_lamports BIGINT NOT NULL DEFAULT 0,
    sam_eligible BOOLEAN NOT NULL DEFAULT false,
    deficit_lamports BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (vote_account, bond_type)
);

-- Append-only log of emitted events
CREATE TABLE IF NOT EXISTS emitted_bond_events (
    id BIGSERIAL PRIMARY KEY,
    message_id UUID NOT NULL,
    inner_type TEXT NOT NULL,
    vote_account TEXT NOT NULL,
    bond_pubkey TEXT,
    bond_type TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emitted_events_vote ON emitted_bond_events(vote_account);
CREATE INDEX IF NOT EXISTS idx_emitted_events_type ON emitted_bond_events(inner_type);
CREATE INDEX IF NOT EXISTS idx_emitted_events_bond_type ON emitted_bond_events(bond_type);
CREATE INDEX IF NOT EXISTS idx_emitted_events_created ON emitted_bond_events(created_at);
