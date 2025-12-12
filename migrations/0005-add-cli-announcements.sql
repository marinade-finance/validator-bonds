CREATE TYPE cli_type AS ENUM ('sam', 'institutional');

-- Used by validator-bonds CLI to display announcements to users
CREATE TABLE cli_announcements (
    id BIGSERIAL NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- group_id: announcements are grouped; the API returns only from the latest group_id
    group_id INTEGER NOT NULL,
    -- group_order: ordering within a group
    group_order INTEGER NOT NULL DEFAULT 0,
    title TEXT,
    text TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    -- operation_filter: if set, show only for this CLI operation (e.g., 'configure-bond', 'fund-bond')
    operation_filter TEXT,
    -- vote_account_filter: if set, show only for this specific vote account
    vote_account_filter TEXT,
    -- type_filter: if set, show only for this CLI type ('sam' or 'institutional')
    type_filter cli_type,
    PRIMARY KEY(id)
);
ALTER TABLE cli_announcements ADD CONSTRAINT group_order_unique UNIQUE (group_id, group_order);
COMMENT ON TABLE cli_announcements IS 'Dynamic announcements displayed to CLI users as banners';

-- Records each time a validator uses the CLI (via announcements endpoint)
CREATE TABLE cli_usage (
    id BIGSERIAL NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    vote_account TEXT,
    operation TEXT,
    cli_version TEXT,
    -- cli_type: which CLI type was used ('sam' or 'institutional')
    cli_type cli_type,
    PRIMARY KEY(id)
);
COMMENT ON TABLE cli_usage IS 'Tracks CLI usage for analytics and understanding validator engagement';

-- Example announcement (survey banner for SAM CLI)
INSERT INTO cli_announcements (group_id, group_order, title, text, enabled, type_filter)
VALUES (
    1,
    0,
    'Help us improve Marinade SAM ✓✓✓',
    E'We''d love your feedback! Please take a minute to fill out our short survey:\nhttps://docs.google.com/forms/d/e/1FAIpQLScnBKcKJsb4-wNSAzgrwrY5boAqG4Y_xsjo4YhND0TfdpUSfw/viewform',
    TRUE,
    'sam'
);
