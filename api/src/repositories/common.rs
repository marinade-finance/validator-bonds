use clap::Args;
use validator_bonds_common::cli_result::CliError;

pub fn pg_transient(err: tokio_postgres::Error) -> CliError {
    let is_transient = err.is_closed()
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
