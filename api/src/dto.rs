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

/// DEPRECATED: the `{ "funder": ... }` wrapper is retained only for backward
/// compatibility. The generated settlement JSON now exposes `funder` directly;
/// this nested `meta` field will be flattened to a top-level `funder` in a future
/// API version. Read `meta.funder` for now.
// Documented on the component, not on ProtectedEventRecord::meta: utoipa renders a bare
// `$ref` for that field and drops sibling `description`/`deprecated` keywords.
#[derive(ToSchema)]
#[schema(as = SettlementMeta, deprecated)]
#[allow(dead_code)]
pub struct SettlementMetaSchema {
    funder: SettlementFunder,
}

/// Amount fields are emitted as JSON doubles, so values above 2^53 are rounded — notably the
/// `u64::MAX` "withdraw everything" sentinel that `remaining_witdraw_request_amount` carries.
#[derive(ToSchema)]
#[schema(as = ValidatorBondRecord)]
#[allow(dead_code)]
pub struct ValidatorBondRecordSchema {
    pubkey: String,
    vote_account: String,
    authority: String,
    // value_type = f64: settlement-common enables rust_decimal/serde-float, so these Decimals reach the wire as JSON numbers rather than utoipa's default string.
    #[schema(value_type = f64)]
    cpmpe: Decimal,
    #[schema(value_type = f64)]
    max_stake_wanted: Decimal,
    epoch: u64,
    #[schema(value_type = f64)]
    funded_amount: Decimal,
    #[schema(value_type = f64)]
    effective_amount: Decimal,
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

    fn sample_record() -> ValidatorBondRecord {
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
            inflation_commission_bps: None,
            mev_commission_bps: None,
            block_commission_bps: None,
        }
    }

    // The notice lives on the component because utoipa emits a bare `$ref` for the field and drops sibling keywords; the key check guards the doc-only mirror against drifting from the real type.
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
                .contains("Read `meta.funder` for now"),
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
        let mut documented: Vec<&str> = schema["properties"]
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        let mut actual: Vec<&str> = serialized
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        documented.sort_unstable();
        actual.sort_unstable();
        assert_eq!(
            documented, actual,
            "SettlementMetaSchema drifted from the serialized SettlementMeta",
        );
    }

    // settlement-common enables rust_decimal/serde-float, so the DTO's Decimal fields go out as JSON numbers while utoipa's `decimal` feature would document them as strings.
    #[test]
    fn bond_record_schema_matches_serialized_json() {
        let docs = serde_json::to_value(ApiDoc::openapi()).unwrap();
        let properties = &docs["components"]["schemas"]["ValidatorBondRecord"]["properties"];
        let serialized = serde_json::to_value(sample_record()).unwrap();

        for field in NUMERIC_FIELDS {
            assert_eq!(
                (
                    properties[field]["type"].as_str(),
                    properties[field]["format"].as_str(),
                ),
                (Some("number"), Some("double")),
                "{field}: documented schema type must match the JSON number the API emits",
            );
            assert!(
                serialized[field].is_number(),
                "{field}: serialized as {:?}, expected a JSON number",
                serialized[field],
            );
        }

        // `date-time` is the registered OpenAPI format; a custom spelling makes generators fall back to a plain string.
        assert_eq!(
            (
                properties["updated_at"]["type"].as_str(),
                properties["updated_at"]["format"].as_str(),
            ),
            (Some("string"), Some("date-time")),
        );
        assert!(
            DateTime::parse_from_rfc3339(serialized["updated_at"].as_str().unwrap_or_default())
                .is_ok(),
            "updated_at serialized as {:?}, expected RFC 3339",
            serialized["updated_at"],
        );
    }
}
