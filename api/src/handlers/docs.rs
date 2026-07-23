use axum::http::header;
use axum::response::IntoResponse;
use log::info;

// Swagger UI is pinned to a specific version for reproducible rendering.
// The OpenAPI spec is served separately at `/docs.json`; Swagger UI links it
// right under the title so consumers can download / reference the raw spec.
const HTML: &str = r##"<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Marinade's Validator Bonds API</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui.css"/>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.onload = function () {
      window.ui = SwaggerUIBundle({
        url: "/docs.json",
        dom_id: "#swagger-ui",
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>"##;

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
