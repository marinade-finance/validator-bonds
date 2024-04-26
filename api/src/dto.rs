use chrono::{DateTime, Utc};
use merkle_tree::serde_serialize::pubkey_string_conversion;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use settlement_engine::settlement_claims::{SettlementMeta, SettlementReason};
use solana_sdk::pubkey::Pubkey;

#[derive(Debug, Serialize, Deserialize, Clone, utoipa::ToSchema)]
pub struct ValidatorBondRecord {
    pub pubkey: String,
    pub vote_account: String,
    pub authority: String,
    pub cpmpe: Decimal,
    pub updated_at: DateTime<Utc>,
    pub epoch: u64,
    pub funded_amount: Decimal,
    pub effective_amount: Decimal,
    pub remaining_witdraw_request_amount: Decimal,
    pub remainining_settlement_claim_amount: Decimal,
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
