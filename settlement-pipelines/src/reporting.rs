use log::{error, info, warn};
use std::future::Future;
use std::ops::{Deref, DerefMut};
use std::pin::Pin;

pub trait PrintReportable {
    fn get_report(&self) -> Pin<Box<dyn Future<Output = Vec<String>> + '_>>;
}

pub struct ReportHandler<T: PrintReportable> {
    pub error_handler: ErrorHandler,
    pub reportable: T,
}

impl<T: PrintReportable> ReportHandler<T> {
    pub fn new(reportable: T) -> Self {
        Self {
            error_handler: ErrorHandler::default(),
            reportable,
        }
    }

    pub async fn report(&self) -> anyhow::Result<()> {
        for report in self.reportable.get_report().await {
            println!("{}", report);
        }
        self.error_handler.report()
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
    warnings: Vec<String>,
    errors: Vec<String>,
}

impl ErrorHandler {
    pub fn add_warning(&mut self, warning: String) {
        warn!("{}", warning);
        self.warnings.push(warning);
    }

    pub fn add_error_string(&mut self, error: String) {
        error!("{}", error);
        self.errors.push(error);
    }

    pub fn add_error(&mut self, error: anyhow::Error) {
        error!("{:?}", error);
        self.errors.push(format!("{:?}", error));
    }

    pub fn add_execution_result(&mut self, execution_result: anyhow::Result<usize>, message: &str) {
        match execution_result {
            Ok(ix_count) => {
                info!("{message}: instructions {ix_count} executed succesfully")
            }
            Err(err) => {
                error!("{message}: instructions execution failures");
                self.add_error(err);
            }
        }
    }

    fn report(&self) -> anyhow::Result<()> {
        if !self.warnings.is_empty() {
            println!("WARNINGS:");
            for warning in &self.warnings {
                println!("{}", warning);
            }
        }

        if !self.errors.is_empty() {
            println!("ERRORS:");
            for error in &self.errors {
                println!("{}", error);
            }
            return Err(anyhow::anyhow!(
                "Errors occurred during processing: {} errors",
                self.errors.len()
            ));
        }

        Ok(())
    }
}
