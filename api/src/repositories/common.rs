use clap::Args;
use validator_bonds_common::cli_result::CliError;
use validator_bonds_common::directory::DirectoryError;

/// Retry what a later run can still win — the store unreachable, a fault on its side, or a byte
/// budget that refills when its window rolls. Every other 4xx will not fix itself: a bad token
/// stays bad, and a 412 means another writer got there first, which is the alarm the
/// serialization gate was bypassed.
pub fn http_transient(err: DirectoryError) -> CliError {
    match err {
        DirectoryError::Transport { .. } => CliError::retry_able(err),
        DirectoryError::Status { status, .. } if status == 429 || status >= 500 => {
            CliError::retry_able(err)
        }
        _ => CliError::critical(err),
    }
}

#[derive(Debug, Args)]
pub struct CommonStoreOptions {
    #[arg(long = "input-file")]
    pub input_path: String,

    #[arg(long = "directory-url", env = "DIRECTORY_URL")]
    pub directory_url: String,

    #[arg(long = "directory-token", env = "DIRECTORY_TOKEN")]
    pub directory_token: String,
}

#[cfg(test)]
#[path = "common_test.rs"]
mod common_test;
