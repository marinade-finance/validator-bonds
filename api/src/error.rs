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

/// Client error, rendered with its message: a caller cannot fix a rejected query parameter without
/// being told which constraint it broke.
pub struct BadRequest {
    pub message: String,
}

impl std::fmt::Debug for BadRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "BadRequest: {}", self.message)
    }
}

impl IntoResponse for BadRequest {
    fn into_response(self) -> Response {
        (StatusCode::BAD_REQUEST, self.message).into_response()
    }
}

pub enum ApiError {
    App(AppError),
    BadRequest(BadRequest),
}

impl From<AppError> for ApiError {
    fn from(error: AppError) -> Self {
        Self::App(error)
    }
}

impl From<BadRequest> for ApiError {
    fn from(error: BadRequest) -> Self {
        Self::BadRequest(error)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        match self {
            Self::App(error) => error.into_response(),
            Self::BadRequest(error) => error.into_response(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;

    async fn rendered(response: Response) -> (StatusCode, String) {
        let status = response.status();
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        (status, String::from_utf8(body.to_vec()).unwrap())
    }

    #[tokio::test]
    async fn app_error_leaks_nothing() {
        let error = AppError {
            message: "connection string postgres://user:secret@host".to_string(),
        };
        let (status, body) = rendered(error.into_response()).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body, "Internal server error");
    }

    #[tokio::test]
    async fn bad_request_returns_its_message() {
        let error = BadRequest {
            message: "from_epoch 1030 is after to_epoch 1020".to_string(),
        };
        let (status, body) = rendered(error.into_response()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body, "from_epoch 1030 is after to_epoch 1020");
    }

    #[tokio::test]
    async fn api_error_keeps_each_variant_status() {
        let app: ApiError = AppError {
            message: "boom".to_string(),
        }
        .into();
        assert_eq!(
            rendered(app.into_response()).await,
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Internal server error".to_string()
            )
        );

        let bad: ApiError = BadRequest {
            message: "unknown label 'dyrect'".to_string(),
        }
        .into();
        assert_eq!(
            rendered(bad.into_response()).await,
            (
                StatusCode::BAD_REQUEST,
                "unknown label 'dyrect'".to_string()
            )
        );
    }
}
