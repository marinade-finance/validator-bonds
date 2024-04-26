use crate::{
    dto::ValidatorBondRecord,
    handlers::{bonds, docs, protected_events},
};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Marinade's Validator Bonds API",
        description = "This API serves data about validators bonds",
        license(
            name = "Apache License, Version 2.0",
            url = "https://www.apache.org/licenses/LICENSE-2.0"
        )
    ),
    components(
        schemas(ValidatorBondRecord),
        schemas(bonds::BondsResponse),
        schemas(protected_events::ProtectedEventsResponse),
    ),
    paths(docs::handler, bonds::handler, protected_events::handler)
)]
pub struct ApiDoc;
