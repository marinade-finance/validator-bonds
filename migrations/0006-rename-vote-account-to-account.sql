-- Rename vote_account columns to account (more generic, can be bond or vote account)

-- cli_announcements: rename vote_account_filter to account_filter
ALTER TABLE cli_announcements RENAME COLUMN vote_account_filter TO account_filter;
COMMENT ON COLUMN cli_announcements.account_filter IS 'If set, show only for this specific account (bond account or vote account)';

-- cli_usage: rename vote_account to account
ALTER TABLE cli_usage RENAME COLUMN vote_account TO account;
COMMENT ON COLUMN cli_usage.account IS 'Account address used in the CLI operation (bond account or vote account)';
