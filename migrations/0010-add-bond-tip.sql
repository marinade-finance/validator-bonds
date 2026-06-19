-- Persist the bond/cap advice ("CTA tip") computed by the eventing pipeline's
-- CTA engine (packages/bonds-eventing/src/cta). The pipeline has the full
-- ds-sam-sdk AuctionValidator + config needed to derive the advice; storing the
-- rendered text + urgency here lets the API and CLI surface it without
-- re-running the auction. Urgency is one of: critical | warning | info |
-- positive | neutral. Null when there is nothing actionable to show.
ALTER TABLE bond_event_state
    ADD COLUMN IF NOT EXISTS bond_tip_text TEXT;
ALTER TABLE bond_event_state
    ADD COLUMN IF NOT EXISTS bond_tip_urgency TEXT;
