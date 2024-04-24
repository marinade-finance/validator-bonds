use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ValidatorBondRecord {
    pub pubkey: String,
    pub vote_account: String,
    pub authority: String,
    pub cpmpe: Decimal,
    pub epoch: u64,
    pub funded_amount: Decimal,
    pub effective_amount: Decimal,
    pub remaining_witdraw_request_amount: Decimal,
    pub remainining_settlement_claim_amount: Decimal,
    pub updated_at: DateTime<Utc>,
}
