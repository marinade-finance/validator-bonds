use bid_psr_distribution::settlement_collection::{
    SettlementFunder, SettlementMeta, SettlementReason,
};
use serde::{Deserialize, Serialize};
use solana_sdk::pubkey::Pubkey;

#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct InstitutionalDistributionConfig {
    pub settlement_meta: SettlementMeta,
    pub settlement_reason: SettlementReason,
    pub marinade_withdraw_authority: Pubkey,
    pub marinade_stake_authority: Pubkey,
}

pub struct ConfigParams {
    pub withdraw_authority: Pubkey,
    pub stake_authority: Pubkey,
}

impl InstitutionalDistributionConfig {
    pub fn new(params: ConfigParams) -> Self {
        InstitutionalDistributionConfig {
            settlement_meta: SettlementMeta {
                funder: SettlementFunder::ValidatorBond,
            },
            settlement_reason: SettlementReason::InstitutionalPayout,
            marinade_withdraw_authority: params.withdraw_authority,
            marinade_stake_authority: params.stake_authority,
        }
    }
}
