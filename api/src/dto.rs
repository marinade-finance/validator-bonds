use chrono::{DateTime, Utc};
use merkle_tree::serde_serialize::pubkey_string_conversion;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use settlement_common::settlement_collection::{
    SettlementFunder, SettlementMeta, SettlementReason,
};
use solana_sdk::pubkey::Pubkey;
use std::error::Error;
use tokio_postgres::types::{FromSql, IsNull, ToSql, Type};
use utoipa::ToSchema;
use validator_bonds_common::dto::BondType;

#[derive(Debug, Serialize, Deserialize, Clone, utoipa::ToSchema)]
pub enum SqlSerializableBondType {
    Bidding,
    Institutional,
}

impl From<BondType> for SqlSerializableBondType {
    fn from(bt: BondType) -> Self {
        match bt {
            BondType::Bidding => Self::Bidding,
            BondType::Institutional => Self::Institutional,
        }
    }
}

impl From<SqlSerializableBondType> for BondType {
    fn from(bt: SqlSerializableBondType) -> BondType {
        match bt {
            SqlSerializableBondType::Bidding => BondType::Bidding,
            SqlSerializableBondType::Institutional => BondType::Institutional,
        }
    }
}

impl ToSql for SqlSerializableBondType {
    fn to_sql(
        &self,
        ty: &Type,
        out: &mut tokio_postgres::types::private::BytesMut,
    ) -> Result<IsNull, Box<dyn Error + Sync + Send>> {
        // Convert the enum to a string that PostgreSQL can understand
        let s = match self {
            SqlSerializableBondType::Bidding => "bidding",
            SqlSerializableBondType::Institutional => "institutional",
        };
        s.to_sql(ty, out)
    }

    fn accepts(ty: &Type) -> bool {
        // This can be used with TEXT, VARCHAR, or our custom ENUM type
        ty.name() == "bonds_types" || <&str as ToSql>::accepts(ty)
    }

    fn to_sql_checked(
        &self,
        ty: &Type,
        out: &mut tokio_postgres::types::private::BytesMut,
    ) -> Result<IsNull, Box<dyn Error + Sync + Send>> {
        if !<Self as ToSql>::accepts(ty) {
            return Err(format!("Cannot convert BondType to {}", ty.name()).into());
        }
        self.to_sql(ty, out)
    }
}

impl<'a> FromSql<'a> for SqlSerializableBondType {
    fn from_sql(ty: &Type, raw: &'a [u8]) -> Result<Self, Box<dyn Error + Sync + Send>> {
        let s = <&str as FromSql>::from_sql(ty, raw)?;

        match s {
            "bidding" => Ok(SqlSerializableBondType::Bidding),
            "institutional" => Ok(SqlSerializableBondType::Institutional),
            _ => Err(format!("Unknown bond type: {s}").into()),
        }
    }

    fn accepts(ty: &Type) -> bool {
        ty.name() == "bonds_types" || <&str as FromSql>::accepts(ty)
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, utoipa::ToSchema)]
pub struct ProtectedEventRecord {
    pub epoch: u64,
    pub amount: u64,
    #[serde(with = "pubkey_string_conversion")]
    pub vote_account: Pubkey,
    pub meta: SettlementMeta,
    pub reason: SettlementReason,
}

/// DEPRECATED: this `{ "funder": ... }` wrapper is retained only for backward compatibility.
/// The generated settlement JSON now exposes `funder` directly, and any field carrying this
/// wrapper will be replaced by a top-level `funder` in a future API version.
/// Read this wrapper's `funder` property for now.
// On the component, not the field: utoipa emits a bare `$ref` there and drops sibling keywords.
#[derive(ToSchema)]
#[schema(as = SettlementMeta, deprecated)]
#[allow(dead_code)]
pub struct SettlementMetaSchema {
    funder: SettlementFunder,
}

#[derive(ToSchema)]
#[schema(as = ValidatorBondRecord)]
#[allow(dead_code)]
pub struct ValidatorBondRecordSchema {
    pubkey: String,
    vote_account: String,
    authority: String,
    // serde-float makes these Decimals serialize as JSON numbers, not utoipa's default string.
    #[schema(value_type = f64)]
    cpmpe: Decimal,
    #[schema(value_type = f64)]
    max_stake_wanted: Decimal,
    epoch: u64,
    #[schema(value_type = f64)]
    funded_amount: Decimal,
    #[schema(value_type = f64)]
    effective_amount: Decimal,
    /// Outstanding withdraw request in lamports, `requested - withdrawn`, reported verbatim — it
    /// may exceed the funded amount, because the request is never validated against the balance.
    /// A "withdraw everything" request instead reports the stake not reserved for settlements.
    #[schema(value_type = f64)]
    remaining_witdraw_request_amount: Decimal,
    #[schema(value_type = f64)]
    remainining_settlement_claim_amount: Decimal,
    updated_at: DateTime<Utc>,
    bond_type: String, // Using String to represent BondType
    inflation_commission_bps: Option<i64>,
    mev_commission_bps: Option<i64>,
    block_commission_bps: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::{SettlementFunder, SettlementMeta};
    use crate::api_docs::ApiDoc;
    use chrono::{DateTime, Utc};
    use rust_decimal::Decimal;
    use settlement_common::protected_events::ProtectedEvent;
    use solana_sdk::pubkey::Pubkey;
    use std::collections::BTreeSet;
    use utoipa::OpenApi;
    use validator_bonds_common::dto::{BondType, ValidatorBondRecord};

    const NUMERIC_FIELDS: [&str; 6] = [
        "cpmpe",
        "max_stake_wanted",
        "funded_amount",
        "effective_amount",
        "remaining_witdraw_request_amount",
        "remainining_settlement_claim_amount",
    ];

    const PROTECTED_EVENT_DECIMAL_FIELDS: [(&str, &[&str]); 4] = [
        ("DowntimeRevenueImpact", &["expected_epr", "actual_epr"]),
        (
            "CommissionSamIncrease",
            &[
                "expected_inflation_commission",
                "actual_inflation_commission",
                "past_inflation_commission",
                "expected_mev_commission",
                "actual_mev_commission",
                "past_mev_commission",
                "before_sam_commission_increase_pmpe",
                "expected_epr",
                "actual_epr",
            ],
        ),
        (
            "CommissionIncrease",
            &["expected_epr", "actual_epr", "stake"],
        ),
        ("LowCredits", &["expected_epr", "actual_epr", "stake"]),
    ];

    // Bonds without a BondProduct serialize the commission fields as `null` — 96% of production
    // rows — so both shapes have to be exercised against the `nullable` documentation.
    fn sample_record(commissions: Option<i64>) -> ValidatorBondRecord {
        ValidatorBondRecord {
            pubkey: "8BopghjQ763ya26YPXSka3eLneU4ENdYMtjtzDLGsMrn".to_owned(),
            vote_account: "We11J5D4iXcNbdMwCZX2o9RRkwaWBo1AGLADfubmeTb".to_owned(),
            authority: "Py1iUEHc6YvkotpA1sjxXBAyBgGJDbQiEnApwse1cTq".to_owned(),
            cpmpe: Decimal::new(2, 1),
            max_stake_wanted: Decimal::new(3, 0),
            epoch: 1008,
            funded_amount: Decimal::new(5, 0),
            effective_amount: Decimal::new(7, 0),
            remaining_witdraw_request_amount: Decimal::new(11, 0),
            remainining_settlement_claim_amount: Decimal::new(13, 0),
            updated_at: Utc::now(),
            bond_type: BondType::Bidding,
            inflation_commission_bps: commissions,
            mev_commission_bps: commissions,
            block_commission_bps: commissions,
        }
    }

    fn json_type(value: &serde_json::Value) -> &'static str {
        match value {
            serde_json::Value::Null => "null",
            serde_json::Value::Bool(_) => "boolean",
            serde_json::Value::Number(number) if number.is_f64() => "number",
            serde_json::Value::Number(_) => "integer",
            serde_json::Value::String(_) => "string",
            serde_json::Value::Array(_) => "array",
            serde_json::Value::Object(_) => "object",
        }
    }

    // A `$ref` is resolved to its component so a referenced enum compares as the string it serializes to.
    fn resolve_ref<'a>(
        docs: &'a serde_json::Value,
        property: &'a serde_json::Value,
    ) -> &'a serde_json::Value {
        match property["$ref"].as_str() {
            Some(reference) => {
                &docs["components"]["schemas"][reference
                    .strip_prefix("#/components/schemas/")
                    .unwrap_or(reference)]
            }
            None => property,
        }
    }

    fn documented_accepts(
        docs: &serde_json::Value,
        property: &serde_json::Value,
        actual: &str,
    ) -> bool {
        let resolved = resolve_ref(docs, property);
        if actual == "null" {
            return resolved["nullable"] == true;
        }
        resolved["type"].as_str() == Some(actual)
    }

    // Guards a hand-written doc-only mirror against the type it claims to describe: same property
    // set, and every serialized value admitted by the documented type (including `nullable`).
    fn assert_shape_matches(
        docs: &serde_json::Value,
        schema: &serde_json::Value,
        serialized: &serde_json::Value,
        label: &str,
    ) {
        let documented: BTreeSet<&str> = schema["properties"]
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        let actual: BTreeSet<&str> = serialized
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            documented, actual,
            "{label}: documented property set drifted from the serialized keys",
        );

        for (name, value) in serialized.as_object().unwrap() {
            let actual_type = json_type(value);
            assert!(
                documented_accepts(docs, &schema["properties"][name], actual_type),
                "{label}.{name}: serialized as {actual_type}, documented as {}",
                schema["properties"][name],
            );
        }
    }

    #[test]
    fn settlement_meta_component_publishes_the_deprecation() {
        let docs = serde_json::to_value(ApiDoc::openapi()).unwrap();
        let schema = &docs["components"]["schemas"]["SettlementMeta"];

        assert_eq!(
            schema["deprecated"].as_bool(),
            Some(true),
            "the meta wrapper must be marked deprecated for consumers",
        );
        assert!(
            schema["description"]
                .as_str()
                .unwrap_or_default()
                .contains("DEPRECATED"),
            "the deprecation notice must reach consumers; got {:?}",
            schema["description"],
        );
        assert_eq!(
            docs["components"]["schemas"]["ProtectedEventRecord"]["properties"]["meta"]["$ref"]
                .as_str(),
            Some("#/components/schemas/SettlementMeta"),
            "the field must still resolve to the deprecated component",
        );

        let serialized = serde_json::to_value(SettlementMeta {
            funder: SettlementFunder::Marinade,
        })
        .unwrap();
        assert_shape_matches(&docs, schema, &serialized, "SettlementMetaSchema");
    }

    #[test]
    fn bond_record_schema_matches_serialized_json() {
        let docs = serde_json::to_value(ApiDoc::openapi()).unwrap();
        let schema = &docs["components"]["schemas"]["ValidatorBondRecord"];
        let properties = &schema["properties"];
        let serialized = serde_json::to_value(sample_record(Some(800))).unwrap();

        for commissions in [None, Some(800)] {
            assert_shape_matches(
                &docs,
                schema,
                &serde_json::to_value(sample_record(commissions)).unwrap(),
                "ValidatorBondRecordSchema",
            );
        }

        for field in NUMERIC_FIELDS {
            assert_eq!(
                (
                    properties[field]["type"].as_str(),
                    properties[field]["format"].as_str(),
                ),
                (Some("number"), Some("double")),
                "{field}: documented schema type must match the JSON number the API emits",
            );
        }

        assert_eq!(
            (
                properties["updated_at"]["type"].as_str(),
                properties["updated_at"]["format"].as_str(),
            ),
            (Some("string"), Some("date-time")),
            "updated_at must publish the registered `date-time` format; a custom spelling makes generators fall back to a plain string",
        );
        assert!(
            DateTime::parse_from_rfc3339(serialized["updated_at"].as_str().unwrap_or_default())
                .is_ok(),
            "updated_at serialized as {:?}, expected RFC 3339",
            serialized["updated_at"],
        );

        assert!(
            properties["remaining_witdraw_request_amount"]["description"]
                .as_str()
                .unwrap_or_default()
                .contains("withdraw"),
            "the withdraw-request caveat must reach consumers; got {:?}",
            properties["remaining_witdraw_request_amount"]["description"],
        );
    }

    // `mev_commission` is Option<Decimal>, so both shapes are built to exercise `nullable`.
    fn sample_protected_events(mev: Option<Decimal>) -> Vec<ProtectedEvent> {
        let vote_account = Pubkey::new_unique();
        vec![
            ProtectedEvent::DowntimeRevenueImpact {
                vote_account,
                actual_credits: 1,
                expected_credits: 2,
                expected_epr: Decimal::new(3, 4),
                actual_epr: Decimal::new(5, 4),
                epr_loss_bps: 6,
                stake: 7,
            },
            ProtectedEvent::CommissionSamIncrease {
                vote_account,
                expected_inflation_commission: Decimal::new(8, 2),
                actual_inflation_commission: Decimal::new(9, 2),
                past_inflation_commission: Decimal::new(10, 2),
                expected_mev_commission: mev,
                actual_mev_commission: mev,
                past_mev_commission: mev,
                before_sam_commission_increase_pmpe: Decimal::new(11, 3),
                expected_epr: Decimal::new(12, 4),
                actual_epr: Decimal::new(13, 4),
                epr_loss_bps: 14,
                stake: 15,
            },
            ProtectedEvent::CommissionIncrease {
                vote_account,
                previous_commission: 1,
                current_commission: 2,
                expected_epr: Decimal::new(16, 4),
                actual_epr: Decimal::new(17, 4),
                epr_loss_bps: 18,
                stake: Decimal::new(19, 0),
            },
            ProtectedEvent::LowCredits {
                vote_account,
                expected_credits: 20,
                actual_credits: 21,
                commission: 3,
                expected_epr: Decimal::new(22, 4),
                actual_epr: Decimal::new(23, 4),
                epr_loss_bps: 24,
                stake: Decimal::new(25, 0),
            },
        ]
    }

    #[test]
    fn protected_event_decimals_are_documented_as_numbers() {
        let docs = serde_json::to_value(ApiDoc::openapi()).unwrap();
        let variants = docs["components"]["schemas"]["ProtectedEvent"]["oneOf"]
            .as_array()
            .unwrap();

        // Comparing against serialized samples rather than a hand-listed field set is what makes a
        // newly added, un-annotated `Decimal` fail here instead of passing unnoticed.
        for mev in [None, Some(Decimal::new(26, 2))] {
            for event in sample_protected_events(mev) {
                let serialized = serde_json::to_value(&event).unwrap();
                let (variant, payload) = serialized
                    .as_object()
                    .unwrap()
                    .iter()
                    .next()
                    .expect("externally tagged enum serializes to one key");
                let variant_schema = variants
                    .iter()
                    .find_map(|v| v["properties"].get(variant))
                    .unwrap_or_else(|| panic!("{variant}: missing from the ProtectedEvent oneOf"));
                assert_shape_matches(&docs, variant_schema, payload, variant);
            }
        }

        for (variant, decimal_fields) in PROTECTED_EVENT_DECIMAL_FIELDS {
            let variant_schema = variants
                .iter()
                .find_map(|v| v["properties"].get(variant))
                .unwrap_or_else(|| panic!("{variant}: missing from the ProtectedEvent oneOf"));
            for field in decimal_fields {
                assert_eq!(
                    (
                        variant_schema["properties"][*field]["type"].as_str(),
                        variant_schema["properties"][*field]["format"].as_str(),
                    ),
                    (Some("number"), Some("double")),
                    "{variant}.{field}: Decimal must publish as a JSON double",
                );
            }
        }
    }
}
