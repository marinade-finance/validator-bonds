use crate::dto::{SettlementMetaSchema, ValidatorBondRecordSchema};
use crate::{
    dto::ProtectedEventRecord,
    handlers::{
        bonds, collected_stake, docs, protected_events, protected_validators, verified_validators,
    },
};
use settlement_common::{
    protected_events::ProtectedEvent,
    settlement_collection::{SettlementFunder, SettlementReason},
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
        schemas(SettlementMetaSchema),
        schemas(SettlementReason),
        schemas(SettlementFunder),
        schemas(ProtectedEvent),
        schemas(bonds::BondsResponse),
        schemas(bonds::AuctionContextResponse),
        schemas(protected_events::ProtectedEventsResponse),
        schemas(verified_validators::VerifiedValidatorsResponse),
        schemas(protected_validators::ProtectedValidatorsResponse),
        schemas(collected_stake::CollectedStakeResponse),
        schemas(collected_stake::AuthorityTotal),
        schemas(collected_stake::ValidatorStake),
        schemas(collected_stake::AuthorityStake),
    ),
    paths(docs::handler, bonds::handler, bonds::handler_institutional, bonds::handler_bidding, bonds::handler_bidding_auction, protected_events::handler, verified_validators::handler, protected_validators::handler, collected_stake::handler),
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

#[cfg(test)]
mod tests {
    use super::ApiDoc;
    use utoipa::OpenApi;

    // `/docs` claiming a path that 404s is what burns consumers, and the `#[utoipa::path]` attribute
    // drifting from `routes.rs` is not a compile error. Source text rather than the axum `Router`,
    // which exposes no way to enumerate what it serves.
    #[test]
    fn every_documented_path_is_routed() {
        let routes = include_str!("routes.rs");
        for path in ApiDoc::openapi().paths.paths.keys() {
            assert!(
                routes.contains(&format!("\"{path}\"")),
                "{path} is documented but not routed",
            );
        }
    }

    // A generated client with no error branch is worse than none: for the two /v1/validators paths
    // the 500 is a chosen state, not a failure.
    #[test]
    fn every_fallible_endpoint_documents_its_error() {
        let docs = serde_json::to_value(ApiDoc::openapi()).unwrap();
        for path in [
            "/bonds",
            "/bonds/bidding",
            "/bonds/institutional",
            "/v1/validators/protected",
            "/v1/validators/stake",
        ] {
            assert!(
                docs["paths"][path]["get"]["responses"]["500"].is_object(),
                "{path} can answer 500 and must document it",
            );
        }
    }

    #[test]
    fn the_validators_family_is_documented_under_v1() {
        let docs = serde_json::to_value(ApiDoc::openapi()).unwrap();
        let documented = docs["paths"].as_object().unwrap();

        for path in [
            "/v1/validators/verified",
            "/v1/validators/protected",
            "/v1/validators/stake",
        ] {
            assert!(documented.contains_key(path), "{path} must be documented");
        }
        for removed in ["/validators/verified", "/validators/protected"] {
            assert!(
                !documented.contains_key(removed),
                "{removed} was moved under /v1 and must no longer be documented",
            );
        }
    }
}
