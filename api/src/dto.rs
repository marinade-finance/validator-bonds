use bid_psr_distribution::settlement_collection::{SettlementMeta, SettlementReason};
use chrono::{DateTime, Utc};
use merkle_tree::serde_serialize::pubkey_string_conversion;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
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
            _ => Err(format!("Unknown bond type: {}", s).into()),
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

#[derive(ToSchema)]
#[schema(as = ValidatorBondRecord)]
#[allow(dead_code)]
pub struct ValidatorBondRecordSchema {
    pubkey: String,
    vote_account: String,
    authority: String,
    cpmpe: Decimal,
    max_stake_wanted: f64,
    epoch: u64,
    funded_amount: f64,
    effective_amount: f64,
    remaining_witdraw_request_amount: f64,
    remainining_settlement_claim_amount: f64,
    #[schema(format = "datetime")]
    updated_at: DateTime<Utc>,
    bond_type: String, // Using String to represent BondType
    inflation_commission_bps: Option<i64>,
    mev_commission_bps: Option<i64>,
    block_commission_bps: Option<i64>,
}
