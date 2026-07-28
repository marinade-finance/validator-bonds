use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

/// Internal error: logged with detail, rendered to the client as an opaque
/// 500 (no internal detail leaked).
pub struct AppError {
    pub message: String,
}

impl std::fmt::Debug for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "AppError: {}", self.message)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        log::error!("{self:?}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Internal server error".to_owned(),
        )
            .into_response()
    }
}
