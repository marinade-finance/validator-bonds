use crate::dto::ValidatorBondRecordSchema;
use crate::{
    dto::ProtectedEventRecord,
    handlers::{bonds, docs, protected_events, verified_validators},
};
use settlement_common::{
    protected_events::ProtectedEvent,
    settlement_collection::{SettlementFunder, SettlementMeta, SettlementReason},
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
        schemas(ValidatorBondRecordSchema),
        schemas(ProtectedEventRecord),
        schemas(SettlementMeta),
        schemas(SettlementReason),
        schemas(SettlementFunder),
        schemas(ProtectedEvent),
        schemas(bonds::BondsResponse),
        schemas(bonds::AuctionContextResponse),
        schemas(protected_events::ProtectedEventsResponse),
        schemas(verified_validators::VerifiedValidatorsResponse),
    ),
    paths(docs::handler, bonds::handler, bonds::handler_institutional, bonds::handler_bidding, bonds::handler_bidding_auction, protected_events::handler, verified_validators::handler),
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
