pub mod anchor;
pub mod arguments;
pub mod init;
pub mod json_data;
pub mod settlements;
pub mod stake_accounts;
pub mod stake_accounts_cache;

// TODO: better to be loaded from chain
pub const STAKE_ACCOUNT_RENT_EXEMPTION: u64 = 2282880;
