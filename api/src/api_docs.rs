use crate::{
    dto::{ProtectedEventRecord, ValidatorBondRecord},
    handlers::{bonds, docs, protected_events},
};
use settlement_engine::{
    protected_events::ProtectedEvent,
    settlement_claims::{SettlementFunder, SettlementMeta, SettlementReason},
};
use solana_sdk::pubkey::Pubkey;
use utoipa::{
    openapi::{self, ObjectBuilder, SchemaType},
    Modify, OpenApi,
};

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
        schemas(ProtectedEventRecord),
        schemas(SettlementMeta),
        schemas(SettlementReason),
        schemas(SettlementFunder),
        schemas(ProtectedEvent),
        schemas(bonds::BondsResponse),
        schemas(protected_events::ProtectedEventsResponse),
    ),
    paths(docs::handler, bonds::handler, protected_events::handler),
    modifiers(&PubkeyScheme),
)]
pub struct ApiDoc;

struct PubkeyScheme;
impl Modify for PubkeyScheme {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        openapi.components.as_mut().unwrap().schemas.insert(
            "Pubkey".into(),
            openapi::schema::Schema::Object(
                ObjectBuilder::new()
                    .schema_type(SchemaType::String)
                    .example(Some(serde_json::Value::String(
                        Pubkey::default().to_string(),
                    )))
                    .build(),
            )
            .into(),
        );
    }
}
