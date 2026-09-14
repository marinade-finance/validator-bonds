use clap::Args;
use serde::de::DeserializeOwned;
use tokio_postgres::error::SqlState;
use validator_bonds_common::cli_result::CliError;

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

pub fn pg_transient(err: tokio_postgres::Error) -> CliError {
    let is_transient = err.is_closed()
        || err.code().is_some_and(is_transient_sql_state)
        || std::error::Error::source(&err)
            .and_then(|s| s.downcast_ref::<std::io::Error>())
            .map(is_transient_io_kind)
            .unwrap_or(false);

    if is_transient {
        CliError::retry_able(err)
    } else {
        CliError::critical(err)
    }
}

// A server answer carries no IO error, yet a lost transaction race or an RDS failover must retry.
fn is_transient_sql_state(code: &SqlState) -> bool {
    matches!(
        *code,
        SqlState::T_R_SERIALIZATION_FAILURE
            | SqlState::T_R_DEADLOCK_DETECTED
            | SqlState::ADMIN_SHUTDOWN
            | SqlState::CRASH_SHUTDOWN
            | SqlState::CANNOT_CONNECT_NOW
    )
}

fn is_transient_io_kind(io: &std::io::Error) -> bool {
    use std::io::ErrorKind::*;
    matches!(
        io.kind(),
        ConnectionRefused
            | ConnectionReset
            | ConnectionAborted
            | NotConnected
            | TimedOut
            | UnexpectedEof
            | Interrupted
            | WouldBlock
    )
}

#[derive(Debug, Args)]
pub struct CommonStoreOptions {
    #[arg(long = "input-file")]
    pub input_path: String,

    #[arg(long = "postgres-url")]
    pub postgres_url: String,

    #[arg(long = "postgres-ssl-root-cert", env = "PG_SSLROOTCERT")]
    pub postgres_ssl_root_cert: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use validator_bonds_common::dto::CollectedStakeRecord;

    fn temp_file(name: &str, content: &[u8]) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("validator-bonds-test-{name}"));
        std::fs::write(&path, content).unwrap();
        path
    }

    /// A `CliError` is what makes the failure appear in the pipeline log at all; a bare
    /// `anyhow::Error` exits 1 silently, which is how these stores used to fail.
    fn assert_logged_and_not_retried(error: &anyhow::Error) {
        assert!(
            matches!(
                error.downcast_ref::<CliError>(),
                Some(CliError::Critical(_))
            ),
            "expected a critical CliError, got: {error}",
        );
    }

    #[test]
    fn a_missing_input_names_the_path_it_could_not_open() {
        let error = read_yaml_input::<Vec<CollectedStakeRecord>>("/nonexistent/collected.yaml")
            .unwrap_err();
        assert!(error.to_string().contains("Failed to open"), "{error}");
        assert!(
            error.to_string().contains("/nonexistent/collected.yaml"),
            "{error}"
        );
        assert_logged_and_not_retried(&error);
    }

    #[test]
    fn malformed_yaml_is_reported_as_critical() {
        let path = temp_file("malformed.yaml", b"- epoch: [unclosed");
        let error =
            read_yaml_input::<Vec<CollectedStakeRecord>>(path.to_str().unwrap()).unwrap_err();
        std::fs::remove_file(&path).unwrap();
        assert!(error.to_string().contains("Failed to parse"), "{error}");
        assert_logged_and_not_retried(&error);
    }

    #[test]
    fn malformed_json_is_reported_as_critical() {
        let path = temp_file("malformed.json", b"{ not json");
        let error = read_json_input::<serde_json::Value>(path.to_str().unwrap()).unwrap_err();
        std::fs::remove_file(&path).unwrap();
        assert!(error.to_string().contains("Failed to parse"), "{error}");
        assert_logged_and_not_retried(&error);
    }

    // A file that parses as the wrong shape is the same class of operator error as a syntax slip.
    #[test]
    fn input_of_the_wrong_shape_is_reported_as_critical() {
        let path = temp_file("wrong-shape.yaml", b"epoch: 1030\n");
        let error =
            read_yaml_input::<Vec<CollectedStakeRecord>>(path.to_str().unwrap()).unwrap_err();
        std::fs::remove_file(&path).unwrap();
        assert!(error.to_string().contains("Failed to parse"), "{error}");
        assert_logged_and_not_retried(&error);
    }

    #[test]
    fn a_well_formed_input_parses() {
        let path = temp_file("empty-list.yaml", b"[]\n");
        let records: Vec<CollectedStakeRecord> = read_yaml_input(path.to_str().unwrap()).unwrap();
        std::fs::remove_file(&path).unwrap();
        assert!(records.is_empty());
    }
}
