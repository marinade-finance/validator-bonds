-- get_bonds_by_type filters on (bond_type, epoch); the only other index leads on pubkey.
CREATE INDEX IF NOT EXISTS idx_bonds_type_epoch ON bonds(bond_type, epoch);
