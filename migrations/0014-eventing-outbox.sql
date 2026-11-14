-- `attempts` caps retries so a row that keeps failing cannot block the pending queue for good.
ALTER TABLE emitted_bond_events
    ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

-- Pre-outbox failures are never resent; sender-made `failed` rows have `last_attempt_at` and stay.
UPDATE emitted_bond_events SET status = 'ignored'
WHERE status = 'failed' AND last_attempt_at IS NULL;

-- The sender reads the pending rows of one bond type in id order.
CREATE INDEX IF NOT EXISTS idx_emitted_events_outbox ON emitted_bond_events(bond_type, status, id);
