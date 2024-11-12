use anyhow::anyhow;
use log::error;
use std::fmt;
use std::fmt::Debug;
use std::process::{ExitCode, Termination};

/// For wrapping the main function to be able to return a Result
/// with specific program exit code you need to use wrapping function calls like this
/// see https://github.com/dtolnay/anyhow/issues/247
///
/// fn main() -> CliResult {
///     CliResult(real_main())
/// }
///
/// fn real_main() -> anyhow::Result<()> {
///     Err(CliError::retry_able("This is a retry-able error"))
/// }
pub struct CliResult(pub anyhow::Result<()>);

impl Termination for CliResult {
    fn report(self) -> ExitCode {
        match self.0 {
            Ok(_) => ExitCode::SUCCESS,
            Err(err) => {
                if let Ok(cli_error) = err.downcast::<CliError>() {
                    cli_error.into()
                } else {
                    ExitCode::FAILURE
                }
            }
        }
    }
}

#[derive(Debug)]
pub enum CliError {
    Critical(anyhow::Error),
    Warning(anyhow::Error),
    RetryAble(anyhow::Error),
}

impl CliError {
    pub fn critical<T: Debug>(err: T) -> anyhow::Error {
        CliError::Critical(anyhow!("{:?}", err)).into()
    }

    pub fn warning<T: Debug>(err: T) -> anyhow::Error {
        CliError::Warning(anyhow!("{:?}", err)).into()
    }

    pub fn retry_able<T: Debug>(err: T) -> anyhow::Error {
        CliError::RetryAble(anyhow!("{:?}", err)).into()
    }
}

impl std::error::Error for CliError {}

impl fmt::Display for CliError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            CliError::Critical(err) => write!(f, "[Critical] {}", err),
            CliError::Warning(err) => write!(f, "[Warning] {}", err),
            CliError::RetryAble(err) => write!(f, "[RetryAble] {}", err),
        }
    }
}

impl From<CliError> for ExitCode {
    fn from(err: CliError) -> ExitCode {
        match err {
            // default exit code for failure is 1
            // we use 2 to show it's an error from our CLI
            CliError::Critical(e) => {
                error!("{:?}", e);
                ExitCode::from(2)
            }
            CliError::Warning(e) => {
                error!("{:?}", e);
                ExitCode::from(99)
            }
            CliError::RetryAble(e) => {
                error!("{:?}", e);
                ExitCode::from(100)
            }
        }
    }
}
