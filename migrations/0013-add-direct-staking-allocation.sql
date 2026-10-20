-- Per-validator routing outcome of `settlement-bond-allocator`, written by
-- `validator-bonds-api-cli store-direct-staking-allocation` from direct-staking-allocation-report.json.
-- Not derivable from settlements: a validator with no usable bond is dropped and produces no
-- settlement at all, so the settlement tables can never show who went unprotected.
-- Column set mirrors stakes-etl's `mainnet_beta_stakes.direct_staking_allocation`, plus `updated_at`,
-- which the store stamps because the report carries no timestamp.
-- The UNIQUE index leads on epoch, so it also serves the range and MAX(epoch) lookups.
CREATE TABLE direct_staking_allocation (
    id                             BIGSERIAL PRIMARY KEY,
    epoch                          INTEGER     NOT NULL,
    slot                           BIGINT      NOT NULL,
    vote_account                   TEXT        NOT NULL,
    outcome                        TEXT        NOT NULL,
    bond_type                      TEXT,
    settlements                    INTEGER     NOT NULL,
    claims_amount                  BIGINT      NOT NULL,
    effective_amount               NUMERIC,
    exposure_bps                   BIGINT,
    bidding_effective_amount       NUMERIC,
    institutional_effective_amount NUMERIC,
    bidding_bonds_epoch            INTEGER,
    institutional_bonds_epoch      INTEGER,
    updated_at                     TIMESTAMPTZ NOT NULL,
    -- The allocator routes or drops each validator once, and `settlements` is already a per-validator count.
    UNIQUE (epoch, vote_account),
    CONSTRAINT outcome_is_known CHECK (outcome IN ('routed', 'dropped')),
    -- Both directions of the discriminated union, so a malformed row cannot be stored and then read
    -- back as a valid one.
    CONSTRAINT routed_carries_its_bond CHECK (
        outcome <> 'routed' OR (bond_type IS NOT NULL
            AND effective_amount IS NOT NULL AND exposure_bps IS NOT NULL)),
    CONSTRAINT dropped_carries_both_amounts CHECK (
        outcome <> 'dropped' OR (bond_type IS NULL
            AND bidding_effective_amount IS NOT NULL
            AND institutional_effective_amount IS NOT NULL))
);
