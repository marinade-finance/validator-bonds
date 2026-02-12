use crate::arguments::{ReportFormat, ReportOpts};
use crate::cli_result::{CliError, CliResult};
use anyhow::format_err;
use chrono::Utc;
use log::{error, info};
use serde::Serialize;
use solana_sdk::pubkey::Pubkey;
use solana_transaction_builder_executor::TransactionBuilderExecutionErrors;
use std::fmt::{self, Display};
use std::fs::File;
use std::future::Future;
use std::io::Write;
use std::path::PathBuf;
use std::pin::Pin;

pub trait PrintReportable {
    fn get_report(&self) -> Pin<Box<dyn Future<Output = Vec<String>> + '_>>;

    fn transform_on_finalize(&self, _entries: &mut Vec<ErrorEntry>) {
        // Default: no transformation
    }
}

/// Trait extending PrintReportable to support JSON serialization of reports
pub trait ReportSerializable: PrintReportable {
    /// Returns the command name for the report
    fn command_name(&self) -> &'static str;

    /// Returns the JSON summary specific to this report type
    fn get_json_summary(&self) -> Pin<Box<dyn Future<Output = serde_json::Value> + '_>>;
}

/// JSON report structures
#[derive(Debug, Clone, Serialize)]
pub struct ReportSummary {
    pub command: String,
    pub timestamp: String,
    pub status: ReportStatus,
    pub summary: serde_json::Value,
    pub errors: Vec<ErrorReportEntry>,
    pub warnings: Vec<ErrorReportEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReportStatus {
    pub success: bool,
    pub error_count: u64,
    pub warning_count: u64,
    pub retryable_error_count: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ErrorReportEntry {
    pub severity: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vote_account: Option<String>,
}

/// Enum representing the output format of a report
pub enum ReportOutput {
    Text(Vec<String>),
    Json(serde_json::Value),
}

impl ReportOutput {
    /// Write the report to a file or stdout
    pub fn write(&self, path: Option<&PathBuf>) -> std::io::Result<()> {
        let content = match self {
            ReportOutput::Text(lines) => lines.join("\n"),
            ReportOutput::Json(value) => serde_json::to_string_pretty(value)
                .unwrap_or_else(|e| format!("{{\"error\": \"{e}\"}}")),
        };

        match path {
            Some(file_path) => {
                let mut file = File::create(file_path)?;
                writeln!(file, "{content}")?;
                Ok(())
            }
            None => {
                println!("{content}");
                Ok(())
            }
        }
    }
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

    pub async fn print_report(&self) {
        for report in self.reportable.get_report().await {
            println!("{report}");
        }
    }

    pub fn warning(&mut self) -> ErrorHandlerBuilder {
        self.error_handler.warning()
    }

    pub fn error(&mut self) -> ErrorHandlerBuilder {
        self.error_handler.error()
    }

    pub fn retryable(&mut self) -> ErrorHandlerBuilder {
        self.error_handler.retryable()
    }

    pub fn add_cli_error(&mut self, error: CliError) {
        self.error_handler.add_cli_error(error);
    }

    pub fn add_tx_execution_result<D: Display>(
        &mut self,
        execution_result: Result<(usize, usize), TransactionBuilderExecutionErrors>,
        message: D,
    ) {
        self.error_handler
            .add_tx_execution_result(execution_result, message);
    }

    pub fn finalize(&mut self) -> anyhow::Result<()> {
        // before finalize make possible to adjust entries
        self.reportable
            .transform_on_finalize(&mut self.error_handler.entries);
        self.error_handler.finalize()
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

    pub fn is_info(&self) -> bool {
        self.severity().is_info()
    }
}

impl Display for ErrorEntry {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ErrorEntry::Generic(err) => write!(f, "{err}"),
            ErrorEntry::VoteAccount(err) => write!(f, "{err}"),
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
        self.message = Some(format!("{err}"));
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

        error!("{entry}");
        self.handler.entries.push(entry);
    }
}

#[derive(Default)]
pub struct ErrorHandler {
    pub entries: Vec<ErrorEntry>,
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
        error!("{error:?}");
        match error {
            CliError::Critical(err) => self.error().with_msg(format!("{err}")).add(),
            CliError::RetryAble(r_err) => self.retryable().with_msg(format!("{r_err}")).add(),
            CliError::Warning(warn) => self.warning().with_msg(format!("{warn}")).add(),
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
                        .with_msg(format!("{single_error}"))
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
        self.entries.iter().filter(|e| e.is_info()).collect()
    }

    /// Returns the status summary for JSON reporting
    pub fn get_status(&self) -> ReportStatus {
        let errors = self.get_errors();
        let warnings = self.get_warnings();
        let retryable = self.get_retryable_errors();

        ReportStatus {
            success: errors.is_empty() && retryable.is_empty(),
            error_count: errors.len() as u64,
            warning_count: warnings.len() as u64,
            retryable_error_count: retryable.len() as u64,
        }
    }

    /// Returns errors as JSON-serializable entries
    pub fn get_errors_as_json(&self) -> Vec<ErrorReportEntry> {
        self.entries
            .iter()
            .filter(|e| e.is_critical() || e.is_retryable())
            .map(error_entry_to_json)
            .collect()
    }

    /// Returns warnings as JSON-serializable entries
    pub fn get_warnings_as_json(&self) -> Vec<ErrorReportEntry> {
        self.entries
            .iter()
            .filter(|e| e.is_warning())
            .map(error_entry_to_json)
            .collect()
    }

    /// Print summary of errors/warnings to stdout (used by with_reporting_ext)
    pub fn print_summary(&self) {
        let infos = self.get_infos();
        if !infos.is_empty() {
            info!("INFOS ({}):", infos.len());
            for info_entry in infos.iter() {
                info!("  {info_entry}");
            }
        }

        let warnings = self.get_warnings();
        if !warnings.is_empty() {
            info!("WARNINGS ({}):", warnings.len());
            for warning in warnings.iter() {
                info!("  {warning}");
            }
        }

        let retryable_errors = self.get_retryable_errors();
        if !retryable_errors.is_empty() {
            info!("TRANSACTION ERRORS ({}):", retryable_errors.len());
            for err in retryable_errors.iter() {
                info!("  {err}");
            }
        }

        let errors = self.get_errors();
        if !errors.is_empty() {
            info!("ERRORS ({}):", errors.len());
            for err in errors.iter() {
                info!("  {err}");
            }
        }
    }

    pub fn finalize(&self) -> anyhow::Result<()> {
        let mut result = anyhow::Ok(());

        let infos = self.get_infos();
        if !infos.is_empty() {
            println!("INFOS ({}):", infos.len());
            for info_entry in infos.iter() {
                println!("{info_entry}");
            }
        }

        let warnings = self.get_warnings();
        if !warnings.is_empty() {
            println!("WARNINGS ({}):", warnings.len());
            for warning in warnings.iter() {
                println!("{warning}");
            }
            result = Err(CliError::warning(format_err!(
                "Some warnings occurred during processing: {} warnings",
                warnings.len()
            )));
        }

        let retryable_errors = self.get_retryable_errors();
        if !retryable_errors.is_empty() {
            println!("TRANSACTION ERRORS ({}):", retryable_errors.len());
            for err in retryable_errors.iter() {
                println!("{err}");
            }
            result = Err(CliError::retry_able(format_err!(
                "Some retry-able errors occurred: {} errors",
                retryable_errors.len()
            )));
        }

        let errors = self.get_errors();
        if !errors.is_empty() {
            println!("ERRORS ({}):", errors.len());
            for err in errors.iter() {
                println!("{err}");
            }
            result = Err(CliError::critical(format_err!(
                "Some errors occurred during processing: {} errors",
                errors.len()
            )));
        }

        result
    }
}

/// Helper function to convert ErrorEntry to ErrorReportEntry for JSON serialization
fn error_entry_to_json(entry: &ErrorEntry) -> ErrorReportEntry {
    match entry {
        ErrorEntry::Generic(err) => ErrorReportEntry {
            severity: err.severity.to_string(),
            message: err.message.clone(),
            source: err.source.clone(),
            vote_account: None,
        },
        ErrorEntry::VoteAccount(err) => ErrorReportEntry {
            severity: err.severity().to_string(),
            message: err.message().to_string(),
            source: err.source().map(|s| s.to_string()),
            vote_account: Some(err.vote_account.to_string()),
        },
    }
}

/// Original with_reporting function for backward compatibility (text output to stdout)
pub async fn with_reporting<T: PrintReportable>(
    report_handler: &mut ReportHandler<T>,
    main_result: anyhow::Result<()>,
) -> CliResult {
    // print report in whatever case
    report_handler.print_report().await;
    match main_result {
        // when Ok is returned we consult the reality with report handler
        Ok(_) => CliResult(report_handler.finalize()),
        // when main returned some error we pass it to terminate with it
        Err(err) => {
            println!("ERROR: {err}");
            CliResult(Err(err))
        }
    }
}

/// Extended with_reporting function that supports text, JSON, and both output formats.
/// Always prints text report to stdout for logging purposes.
pub async fn with_reporting_ext<T: ReportSerializable>(
    report_handler: &mut ReportHandler<T>,
    main_result: anyhow::Result<()>,
    report_opts: &ReportOpts,
) -> CliResult {
    // Transform entries before any reporting
    report_handler
        .reportable
        .transform_on_finalize(&mut report_handler.error_handler.entries);

    // Get text report for stdout (always printed for logging)
    let text_report = report_handler.reportable.get_report().await;

    // Build JSON report data
    let status = report_handler.error_handler.get_status();
    let errors = report_handler.error_handler.get_errors_as_json();
    let warnings = report_handler.error_handler.get_warnings_as_json();
    let summary = report_handler.reportable.get_json_summary().await;

    let report_summary = ReportSummary {
        command: report_handler.reportable.command_name().to_string(),
        timestamp: Utc::now().to_rfc3339(),
        status: status.clone(),
        summary,
        errors,
        warnings,
    };

    // Always print text report
    for line in &text_report {
        info!("{line}");
    }

    // Print error summary to stdout
    report_handler.error_handler.print_summary();

    // Handle file output based on format
    match report_opts.report_format {
        ReportFormat::Text => {
            if let Some(ref file_path) = report_opts.report_file {
                let output = ReportOutput::Text(text_report);
                if let Err(e) = output.write(Some(file_path)) {
                    error!("Failed to write text report file: {e}");
                }
            }
        }
        ReportFormat::Json => {
            let json_value = serde_json::to_value(&report_summary)
                .unwrap_or_else(|e| serde_json::json!({"error": e.to_string()}));
            let output = ReportOutput::Json(json_value);
            if let Err(e) = output.write(report_opts.report_file.as_ref()) {
                error!("Failed to write JSON report: {e}");
            }
        }
        ReportFormat::Both => {
            if let Some(ref file_path) = report_opts.report_file {
                // Write text file with .txt extension
                let txt_path = file_path.with_extension("txt");
                let text_output = ReportOutput::Text(text_report);
                if let Err(e) = text_output.write(Some(&txt_path)) {
                    error!("Failed to write text report file: {e}");
                }

                // Write JSON file with .json extension
                let json_path = file_path.with_extension("json");
                let json_value = serde_json::to_value(&report_summary)
                    .unwrap_or_else(|e| serde_json::json!({"error": e.to_string()}));
                let json_output = ReportOutput::Json(json_value);
                if let Err(e) = json_output.write(Some(&json_path)) {
                    error!("Failed to write JSON report file: {e}");
                }
            }
        }
    }

    // Handle main error if present
    if let Err(err) = main_result {
        error!("ERROR: {err}");
        return CliResult(Err(err));
    }

    // Determine exit result based on error handler status
    if status.error_count > 0 {
        CliResult(Err(CliError::critical(format_err!(
            "Errors occurred: {} errors",
            status.error_count
        ))))
    } else if status.retryable_error_count > 0 {
        CliResult(Err(CliError::retry_able(format_err!(
            "Retryable errors occurred: {} errors",
            status.retryable_error_count
        ))))
    } else {
        CliResult(Ok(()))
    }
}
