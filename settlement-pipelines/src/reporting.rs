use crate::cli_result::{CliError, CliResult};
use log::{error, info};
use solana_transaction_builder_executor::TransactionBuilderExecutionErrors;
use std::fmt::Display;
use std::future::Future;
use std::ops::{Deref, DerefMut};
use std::pin::Pin;

pub trait PrintReportable {
    fn get_report(&self) -> Pin<Box<dyn Future<Output = Vec<String>> + '_>>;
}

pub struct ReportHandler<T: PrintReportable> {
    error_handler: ErrorHandler,
    pub reportable: T,
}

impl<T: PrintReportable> ReportHandler<T> {
    pub fn new(reportable: T) -> Self {
        Self {
            error_handler: ErrorHandler::default(),
            reportable,
        }
    }

    pub async fn print_report(&self) {
        for report in self.reportable.get_report().await {
            println!("{}", report);
        }
    }
}

impl<T: PrintReportable> Deref for ReportHandler<T> {
    type Target = ErrorHandler;

    fn deref(&self) -> &Self::Target {
        &self.error_handler
    }
}

impl<T: PrintReportable> DerefMut for ReportHandler<T> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.error_handler
    }
}

#[derive(Default)]
pub struct ErrorHandler {
    retry_able_errors: Vec<String>,
    errors: Vec<String>,
    warnings: Vec<String>,
}

impl ErrorHandler {
    pub fn add_error_string<D: Display>(&mut self, error: D) {
        error!("{}", error);
        self.errors.push(error.to_string());
    }

    pub fn add_error(&mut self, error: anyhow::Error) {
        error!("{:?}", error);
        self.errors.push(format!("{}", error));
    }

    pub fn add_warning_string<D: Display>(&mut self, warning: D) {
        error!("{}", warning);
        self.warnings.push(warning.to_string());
    }

    pub fn add_warning(&mut self, warning: anyhow::Error) {
        error!("{:?}", warning);
        self.warnings.push(format!("{}", warning));
    }

    pub fn add_retry_able_error(&mut self, error: anyhow::Error) {
        error!("{:?}", error);
        self.retry_able_errors.push(format!("{}", error));
    }

    pub fn add_cli_error(&mut self, error: CliError) {
        error!("{:?}", error);
        match error {
            CliError::Critical(err) => self.add_error(err),
            CliError::RetryAble(err) => self.add_retry_able_error(err),
            CliError::Warning(err) => self.add_warning(err),
        }
    }

    pub fn add_tx_execution_result<D: Display>(
        &mut self,
        execution_result: Result<(usize, usize), TransactionBuilderExecutionErrors>,
        message: D,
    ) {
        match execution_result {
            Ok((tx_count, ix_count)) => {
                info!("{message}: txes {tx_count}/ixes {ix_count} executed successfully")
            }
            Err(err) => {
                for single_error in err.into_iter() {
                    self.add_retry_able_error(anyhow::Error::from(single_error));
                }
            }
        }
    }

    pub fn finalize(&self) -> anyhow::Result<()> {
        let mut result = anyhow::Ok(());

        if !self.warnings.is_empty() {
            println!("WARNINGS ({}):", self.warnings.len());
            for warning in &self.warnings {
                println!("{}", warning);
            }
            result = Err(CliError::warning(format!(
                "Some warnings occurred during processing: {} warnings",
                self.warnings.len()
            )));
        }

        if !self.errors.is_empty() {
            println!("ERRORS ({}):", self.errors.len());
            for error in &self.errors {
                println!("{}", error);
            }
            result = Err(CliError::critical(format!(
                "Some errors occurred during processing: {} errors",
                self.errors.len()
            )));
        }

        if !self.retry_able_errors.is_empty() {
            println!("TRANSACTION ERRORS ({}):", self.retry_able_errors.len());
            for error in &self.retry_able_errors {
                println!("{}", error);
            }
            result = Err(CliError::retry_able(format!(
                "Some retry-able errors occurred: {} errors",
                self.retry_able_errors.len()
            )));
        }

        result
    }
}

pub async fn with_reporting<T: PrintReportable>(
    report_handler: &ReportHandler<T>,
    main_result: anyhow::Result<()>,
) -> CliResult {
    // print report in whatever case
    report_handler.print_report().await;
    match main_result {
        // when Ok is returned we consult the reality with report handler
        Ok(_) => CliResult(report_handler.finalize()),
        // when main returned some error we pass it to terminate with it
        Err(err) => {
            println!("ERROR: {}", err);
            CliResult(Err(err))
        }
    }
}
