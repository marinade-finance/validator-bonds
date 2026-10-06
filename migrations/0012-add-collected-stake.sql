-- Marinade-routed stake per validator per configured staker authority, written by
-- `bonds-collector collect-stake`. Readers pin epoch = MAX(epoch), the same contract as `bonds`.
-- `deactivating` is a SUBSET of `effective`, never an addend: Agave keeps stake in its deactivation
-- epoch effective for that epoch, so active-only is `effective - deactivating`.
-- The UNIQUE index leads on epoch, so it also serves the MAX(epoch) lookup; no extra index needed.
CREATE TABLE collected_stake (
    id              BIGSERIAL PRIMARY KEY,
    epoch           INTEGER     NOT NULL,
    slot            BIGINT      NOT NULL,
    label           TEXT        NOT NULL,
    stake_authority TEXT        NOT NULL,
    vote_account    TEXT        NOT NULL,
    effective       BIGINT      NOT NULL,
    activating      BIGINT      NOT NULL,
    deactivating    BIGINT      NOT NULL,
    stake_accounts  INTEGER     NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL,
    UNIQUE (epoch, stake_authority, vote_account)
);
