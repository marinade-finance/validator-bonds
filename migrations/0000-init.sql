CREATE TABLE bonds (
  id BIGSERIAL NOT NULL,
  pubkey TEXT NOT NULL,
  vote_account TEXT NOT NULL,
  authority TEXT NOT NULL,
  cpmpe NUMERIC NOT NULL,
  epoch INTEGER NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
  PRIMARY KEY(id)
)

ALTER TABLE bonds ADD CONSTRAINT pubkey_epoch_unique UNIQUE (pubkey, epoch);