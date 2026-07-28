use axum::http::header;
use axum::response::IntoResponse;
use log::info;

const HTML: &str = "<!doctype html>
<html>
<head>
  <meta charset=\"UTF-8\"/>
</head>
<body>
  <redoc spec-url=\"/docs.json\" native-scrollbars></redoc>
  <script src=\"https://public.marinade.finance/redoc.v2.0.0.standalone.js\"></script>
</body>
</html>";

#[utoipa::path(
    get,
    tag = "General",
    operation_id = "Docs",
    path = "/docs",
    responses(
        (status = 200)
    )
)]
pub async fn handler() -> impl IntoResponse {
    info!("Serving the docs");
    ([(header::CONTENT_TYPE, "text/html")], HTML)
}
