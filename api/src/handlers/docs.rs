use axum::http::header;
use axum::response::IntoResponse;
use log::info;

// Swagger UI is pinned to a specific version for reproducible rendering, with
// subresource integrity hashes so a compromised or mirrored CDN cannot swap the
// assets. When bumping the version both `integrity` hashes must be regenerated:
//   curl -sSL https://cdn.jsdelivr.net/npm/swagger-ui-dist@<ver>/<file> \
//     | openssl dgst -sha384 -binary | openssl base64 -A
// The OpenAPI spec is served separately at `/docs.json`; Swagger UI links it
// right under the title so consumers can download / reference the raw spec.
//
// The page is deliberately read-only, matching the Redoc page it replaced:
// `supportedSubmitMethods: []` drops the "Try it out" / "Execute" console, which
// would otherwise call production and render multi-megabyte responses (e.g.
// `/protected-events`) through the syntax highlighter in the visitor's browser.
// `validatorUrl: null` keeps the spec from being shipped to the public
// validator.swagger.io service, and `queryConfigEnabled: false` pins the
// current default so `?url=` cannot point the page at a foreign spec.
const HTML: &str = r##"<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Marinade's Validator Bonds API</title>
  <link rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.32.11/swagger-ui.css"
        integrity="sha384-9Q2fpS+xeS4ffJy6CagnwoUl+4ldAYhOs9pgZuEKxypVModhmZFzeMlvVsAjf7uT"
        crossorigin="anonymous"/>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.32.11/swagger-ui-bundle.js"
          integrity="sha384-vfl/klfTFrIz5urj0HnhcXLAbzPdRHezizfy+XgFB6GqcKkhlk0lS3bIbyB39NLA"
          crossorigin="anonymous"></script>
  <script>
    window.onload = function () {
      window.ui = SwaggerUIBundle({
        url: "/docs.json",
        dom_id: "#swagger-ui",
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis],
        layout: "BaseLayout",
        supportedSubmitMethods: [],
        validatorUrl: null,
        queryConfigEnabled: false
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
