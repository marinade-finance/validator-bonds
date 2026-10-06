use clap::Args;
use validator_bonds_common::cli_result::CliError;
use validator_bonds_common::directory::DirectoryError;

/// Retries what a later run can still win: transport failures, 5xx, and 429 (a byte budget that
/// refills). Every other status is critical; a 412 means a second writer got past the
/// serialization gate.
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
