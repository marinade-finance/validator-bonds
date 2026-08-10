use clap::Args;
use tokio_postgres::error::SqlState;
use validator_bonds_common::cli_result::CliError;

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
