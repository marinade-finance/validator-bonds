use crate::settlement_data::{SettlementFunderType, SettlementRecord};
use clap::Args;

/// CLI options for the global reserve that fronts mSOL bid payouts. A zero
/// prefund turns the reserve off.
#[derive(Debug, Clone, Args)]
pub struct ReserveOpts {
    /// Lamports the reserve pre-funds per bond settlement (R). On first touch
    /// the fund pass creates an undelegated stake of R from marinade_wallet so
    /// stakers can claim immediately; the bond funds the remaining C-R; at close
    /// the undelegated leftover reaps back to marinade_wallet.
    #[arg(long, env, default_value_t = 0)]
    pub reserve_prefund_lamports: u64,
}

/// Whether the reserve fronts this settlement. Bond-funded only: Marinade-funded
/// settlements (e.g. PSR) fund from marinade_wallet directly, are already
/// claimable on time, and have no bond to reimburse a front.
pub fn is_reserve_target(record: &SettlementRecord) -> bool {
    matches!(record.funder, SettlementFunderType::ValidatorBond(_))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settlement_data::{SettlementFunderType, SettlementRecord};
    use anchor_client::anchor_lang::prelude::Pubkey;
    use std::collections::HashMap;

    fn record(funder: SettlementFunderType) -> SettlementRecord {
        SettlementRecord {
            epoch: 0,
            vote_account_address: Pubkey::new_unique(),
            bond_address: Pubkey::default(),
            bond_account: None,
            settlement_address: Pubkey::default(),
            settlement_account: None,
            settlement_staker_authority: Pubkey::default(),
            merkle_root: [0u8; 32],
            tree_nodes: vec![],
            max_total_claim_sum: 0,
            max_total_claim: 0,
            funder,
            reason: None,
            funding_sources: HashMap::new(),
            reserve_front: 0,
        }
    }

    #[test]
    fn is_reserve_target_bond_only() {
        assert!(is_reserve_target(&record(
            SettlementFunderType::ValidatorBond(vec![])
        )));
        assert!(!is_reserve_target(&record(SettlementFunderType::Marinade(
            None
        ))));
    }
}
