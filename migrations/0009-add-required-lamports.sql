-- Track the bond balance (in lamports) required to cover the validator's
-- currently delegated stake for one epoch of bid coverage plus on-chain
-- obligations. The ds-sam SDK derived `required_sol` is what
-- `computeDeficitMetrics` already computes; persisting it lets the API and CLI
-- surface the minimum bond balance below which stake is at risk of being
-- undelegated. `deficit_lamports` only stores max(0, required - balance), so
-- the absolute requirement cannot be recovered once the bond is funded enough.
ALTER TABLE bond_event_state
    ADD COLUMN IF NOT EXISTS required_lamports BIGINT;
