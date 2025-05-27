use crate::cli_result::{CliError, CliResult};
use anyhow::format_err;
use log::{error, info};
use solana_sdk::pubkey::Pubkey;
use solana_transaction_builder_executor::TransactionBuilderExecutionErrors;
use std::fmt::{self, Display};
use std::future::Future;
use std::ops::{Deref, DerefMut};
use std::pin::Pin;

pub trait PrintReportable {
    fn get_report(&self) -> Pin<Box<dyn Future<Output = Vec<String>> + '_>>;

    fn transform_on_finalize(&self, _entries: &mut Vec<ErrorEntry>) {
        // Default: no transformation
    }
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorSeverity {
    Warning,
    Error,
    RetryableError,
    Info,
}

impl ErrorSeverity {
    pub fn is_retryable(&self) -> bool {
        matches!(self, ErrorSeverity::RetryableError)
    }

    pub fn is_critical(&self) -> bool {
        matches!(self, ErrorSeverity::Error)
    }

    pub fn is_warning(&self) -> bool {
        matches!(self, ErrorSeverity::Warning)
    }

    pub fn is_info(&self) -> bool {
        matches!(self, ErrorSeverity::Info)
    }
}

impl Display for ErrorSeverity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ErrorSeverity::Warning => write!(f, "WARNING"),
            ErrorSeverity::Error => write!(f, "ERROR"),
            ErrorSeverity::RetryableError => write!(f, "RETRYABLE_ERROR"),
            ErrorSeverity::Info => write!(f, "INFO"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct GenericError {
    pub message: String,
    pub severity: ErrorSeverity,
    pub source: Option<String>,
}

impl GenericError {
    pub fn new(message: impl Into<String>, severity: ErrorSeverity) -> Self {
        Self {
            message: message.into(),
            severity,
            source: None,
        }
    }

    pub fn with_source(mut self, source: impl Into<String>) -> Self {
        self.source = Some(source.into());
        self
    }

    pub fn warning(message: impl Into<String>) -> Self {
        Self::new(message, ErrorSeverity::Warning)
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self::new(message, ErrorSeverity::Error)
    }

    pub fn retryable(message: impl Into<String>) -> Self {
        Self::new(message, ErrorSeverity::RetryableError)
    }
}

impl Display for GenericError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(source) = &self.source {
            write!(f, "{} (source: {})", self.message, source)
        } else {
            write!(f, "{}", self.message)
        }
    }
}

#[derive(Debug, Clone)]
pub struct VoteAccountError {
    pub base: GenericError,
    pub vote_account: Pubkey,
}

impl VoteAccountError {
    pub fn new(
        message: impl Into<String>,
        severity: ErrorSeverity,
        vote_account: impl Into<Pubkey>,
    ) -> Self {
        Self {
            base: GenericError::new(message, severity),
            vote_account: vote_account.into(),
        }
    }

    pub fn with_source(mut self, source: impl Into<String>) -> Self {
        self.base = self.base.with_source(source);
        self
    }

    pub fn warning(message: impl Into<String>, vote_account: impl Into<Pubkey>) -> Self {
        Self::new(message, ErrorSeverity::Warning, vote_account)
    }

    pub fn error(message: impl Into<String>, vote_account: impl Into<Pubkey>) -> Self {
        Self::new(message, ErrorSeverity::Error, vote_account)
    }

    pub fn retryable(message: impl Into<String>, vote_account: impl Into<Pubkey>) -> Self {
        Self::new(message, ErrorSeverity::RetryableError, vote_account)
    }

    // Delegate common methods to base
    pub fn severity(&self) -> ErrorSeverity {
        self.base.severity
    }

    pub fn message(&self) -> &str {
        &self.base.message
    }

    pub fn source(&self) -> Option<&str> {
        self.base.source.as_deref()
    }
}

impl Display for VoteAccountError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} (vote_account: {})", self.base, self.vote_account)
    }
}

#[derive(Debug, Clone)]
pub enum ErrorEntry {
    Generic(GenericError),
    VoteAccount(VoteAccountError),
}

impl ErrorEntry {
    pub fn severity(&self) -> ErrorSeverity {
        match self {
            ErrorEntry::Generic(err) => err.severity,
            ErrorEntry::VoteAccount(err) => err.severity(),
        }
    }

    pub fn is_retryable(&self) -> bool {
        self.severity().is_retryable()
    }

    pub fn is_critical(&self) -> bool {
        self.severity().is_critical()
    }

    pub fn is_warning(&self) -> bool {
        self.severity().is_warning()
    }
}

impl Display for ErrorEntry {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ErrorEntry::Generic(err) => write!(f, "{}", err),
            ErrorEntry::VoteAccount(err) => write!(f, "{}", err),
        }
    }
}

#[must_use = "ErrorHandlerBuilder must be consumed with .add()"]
pub struct ErrorHandlerBuilder<'a> {
    handler: &'a mut ErrorHandler,
    severity: ErrorSeverity,
    message: Option<String>,
    source: Option<String>,
    vote_account: Option<Pubkey>,
}

impl<'a> ErrorHandlerBuilder<'a> {
    fn new(handler: &'a mut ErrorHandler, severity: ErrorSeverity) -> Self {
        Self {
            handler,
            severity,
            message: None,
            source: None,
            vote_account: None,
        }
    }

    pub fn with_msg<D: Display>(mut self, message: D) -> Self {
        self.message = Some(message.to_string());
        self
    }

    pub fn with_err(mut self, err: anyhow::Error) -> Self {
        self.message = Some(format!("{}", err));
        self
    }

    pub fn with_source<S: Into<String>>(mut self, source: S) -> Self {
        self.source = Some(source.into());
        self
    }

    pub fn with_vote<V: Into<Pubkey>>(mut self, vote_account: V) -> Self {
        self.vote_account = Some(vote_account.into());
        self
    }

    pub fn add(self) {
        let message = self
            .message
            .expect("Message is required - use with_msg() or with_err()");

        let entry = if let Some(vote_account) = self.vote_account {
            let mut vote_error = VoteAccountError::new(message, self.severity, vote_account);
            if let Some(source) = self.source {
                vote_error = vote_error.with_source(source);
            }
            ErrorEntry::VoteAccount(vote_error)
        } else {
            let mut generic_error = GenericError::new(message, self.severity);
            if let Some(source) = self.source {
                generic_error = generic_error.with_source(source);
            }
            ErrorEntry::Generic(generic_error)
        };

        error!("{}", entry);
        self.handler.entries.push(entry);
    }
}

#[derive(Default)]
pub struct ErrorHandler {
    entries: Vec<ErrorEntry>,
}

impl ErrorHandler {
    // Fluent API entry points
    pub fn error(&mut self) -> ErrorHandlerBuilder {
        ErrorHandlerBuilder::new(self, ErrorSeverity::Error)
    }

    pub fn warning(&mut self) -> ErrorHandlerBuilder {
        ErrorHandlerBuilder::new(self, ErrorSeverity::Warning)
    }

    pub fn retryable(&mut self) -> ErrorHandlerBuilder {
        ErrorHandlerBuilder::new(self, ErrorSeverity::RetryableError)
    }

    pub fn add_cli_error(&mut self, error: CliError) {
        error!("{:?}", error);
        match error {
            CliError::Critical(err) => self.error().with_msg(format!("{}", err)).add(),
            CliError::RetryAble(r_err) => self.retryable().with_msg(format!("{}", r_err)).add(),
            CliError::Warning(warn) => self.warning().with_msg(format!("{}", warn)).add(),
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
                    self.retryable()
                        .with_msg(format!("{}", single_error))
                        .with_source("transaction_execution")
                        .add();
                }
            }
        }
    }

    pub fn get_warnings(&self) -> Vec<&ErrorEntry> {
        self.entries.iter().filter(|e| e.is_warning()).collect()
    }

    pub fn get_errors(&self) -> Vec<&ErrorEntry> {
        self.entries.iter().filter(|e| e.is_critical()).collect()
    }

    pub fn get_retryable_errors(&self) -> Vec<&ErrorEntry> {
        self.entries.iter().filter(|e| e.is_retryable()).collect()
    }

    pub fn get_infos(&self) -> Vec<&ErrorEntry> {
        self.entries
            .iter()
            .filter(|e| e.severity() == ErrorSeverity::Info)
            .collect()
    }

    pub fn finalize(&self) -> anyhow::Result<()> {
        let mut result = anyhow::Ok(());

        let infos = self.get_infos();
        if !infos.is_empty() {
            println!("INFOS ({}):", infos.len());
            for info in infos.iter() {
                println!("{}", info);
            }
        }

        let warnings = self.get_warnings();
        if !warnings.is_empty() {
            println!("WARNINGS ({}):", warnings.len());
            for warning in warnings.iter() {
                println!("{}", warning);
            }
            result = Err(CliError::warning(format_err!(
                "Some warnings occurred during processing: {} warnings",
                warnings.len()
            )));
        }

        let retryable_errors = self.get_retryable_errors();
        if !retryable_errors.is_empty() {
            println!("TRANSACTION ERRORS ({}):", retryable_errors.len());
            for error in retryable_errors.iter() {
                println!("{}", error);
            }
            result = Err(CliError::retry_able(format_err!(
                "Some retry-able errors occurred: {} errors",
                retryable_errors.len()
            )));
        }

        let errors = self.get_errors();
        if !errors.is_empty() {
            println!("ERRORS ({}):", errors.len());
            for error in errors.iter() {
                println!("{}", error);
            }
            result = Err(CliError::critical(format_err!(
                "Some errors occurred during processing: {} errors",
                errors.len()
            )));
        }

        result
    }
}

pub async fn with_reporting<T: PrintReportable>(
    report_handler: &mut ReportHandler<T>,
    main_result: anyhow::Result<()>,
) -> CliResult {
    // print report in whatever case
    report_handler.print_report().await;
    match main_result {
        // when Ok is returned we consult the reality with report handler
        Ok(_) => {
            // before returning result from finalize make possible to adjust entries
            report_handler
                .reportable
                .transform_on_finalize(&mut report_handler.error_handler.entries);
            CliResult(report_handler.finalize())
        }
        // when main returned some error we pass it to terminate with it
        Err(err) => {
            println!("ERROR: {}", err);
            CliResult(Err(err))
        }
    }
}
