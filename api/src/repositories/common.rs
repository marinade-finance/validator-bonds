use clap::Args;
use serde::de::DeserializeOwned;
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

/// Every store reads its input this way, because `CliResult` logs only what downcasts to a
/// `CliError`: a bare `anyhow::Error` here exits 1 with nothing printed, leaving the pipeline step
/// red with no reason. Critical rather than retry-able — re-reading an unparsable file cannot fix it.
pub fn read_yaml_input<T: DeserializeOwned>(input_path: &str) -> anyhow::Result<T> {
    let input = open_input(input_path)?;
    serde_yaml::from_reader(input).map_err(|error| parse_failed(input_path, error))
}

pub fn read_json_input<T: DeserializeOwned>(input_path: &str) -> anyhow::Result<T> {
    let input = open_input(input_path)?;
    serde_json::from_reader(input).map_err(|error| parse_failed(input_path, error))
}

fn open_input(input_path: &str) -> anyhow::Result<std::fs::File> {
    std::fs::File::open(input_path).map_err(|error| {
        CliError::critical(anyhow::anyhow!("Failed to open {input_path}: {error}")).into()
    })
}

fn parse_failed(input_path: &str, error: impl std::fmt::Display) -> anyhow::Error {
    CliError::critical(anyhow::anyhow!("Failed to parse {input_path}: {error}")).into()
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
