-- Penalty kinds already announced, so the eventing emits each once per epoch instead of every run.
ALTER TABLE bond_event_state ADD COLUMN IF NOT EXISTS projected_penalties JSONB;
ALTER TABLE bond_event_state ADD COLUMN IF NOT EXISTS expected_penalties JSONB;
