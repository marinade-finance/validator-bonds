use log::{error, info};
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

    pub async fn report_and_exit(&self) -> anyhow::Result<()> {
        for report in self.reportable.get_report().await {
            println!("{}", report);
        }
        self.error_handler.report_and_exit();
        Ok(())
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
    tx_errors: Vec<String>,
    errors: Vec<String>,
}

impl ErrorHandler {
    pub fn add_error_string(&mut self, error: String) {
        error!("{}", error);
        self.errors.push(error);
    }

    pub fn add_error(&mut self, error: anyhow::Error) {
        error!("{:?}", error);
        self.errors.push(format!("{:?}", error));
    }

    pub fn add_tx_error(&mut self, error: anyhow::Error) {
        error!("{:?}", error);
        self.tx_errors.push(format!("{:?}", error));
    }

    pub fn add_tx_execution_result(
        &mut self,
        execution_result: anyhow::Result<usize>,
        message: &str,
    ) {
        match execution_result {
            Ok(ix_count) => {
                info!("{message}: instructions {ix_count} executed succesfully")
            }
            Err(err) => {
                self.add_tx_error(err);
            }
        }
    }

    fn report_and_exit(&self) {
        let mut exit_code: i32 = 0;

        if !self.errors.is_empty() {
            error!(
                "Errors occurred during processing: {} errors",
                self.errors.len()
            );
            println!("ERRORS:");
            for error in &self.errors {
                println!("{}", error);
            }
            exit_code = 1;
        }

        if !self.tx_errors.is_empty() {
            error!(
                "Errors occurred during transaction processing: {} errors",
                self.tx_errors.len()
            );
            println!("TRANSACTION ERRORS:");
            for error in &self.tx_errors {
                println!("{}", error);
            }
            // expected this is a retryable error
            exit_code = 100;
        }

        std::process::exit(exit_code);
    }
}
