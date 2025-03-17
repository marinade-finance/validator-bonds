CREATE TYPE bonds_types AS ENUM ('bidding', 'institutional');

ALTER TABLE bonds ADD COLUMN bond_type bonds_types NOT NULL DEFAULT 'bidding';

