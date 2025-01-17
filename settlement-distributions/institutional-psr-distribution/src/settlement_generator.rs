use crate::institutional_psr_payouts::InstitutionalPsrPayout;
use bid_psr_distribution::settlement_collection::{
    Settlement, SettlementClaim, SettlementCollection, SettlementFunder, SettlementMeta,
    SettlementReason,
};
use log::info;

use solana_sdk::pubkey::Pubkey;
use std::collections::HashMap;

pub fn generate_institutional_psr_settlement_collection(
    institutional_psr_payout: &InstitutionalPsrPayout,
) -> SettlementCollection {
    let settlements = generate_institutional_psr_settlements(institutional_psr_payout);

    SettlementCollection {
        slot: institutional_psr_payout.slot,
        epoch: institutional_psr_payout.epoch,
        settlements,
    }
}

fn generate_institutional_psr_settlements(
    institutional_psr_payout: &InstitutionalPsrPayout,
) -> Vec<Settlement> {
    info!("Generating institutional PSR settlements...");

    // settlement per validator (i.e., vote account)
    let mut settlements: HashMap<Pubkey, Settlement> = HashMap::new();

    for payout in institutional_psr_payout.payouts.iter() {
        let settlement = settlements.entry(payout.validator).or_insert(Settlement {
            reason: SettlementReason::InstitutionalProtectedEvent,
            meta: SettlementMeta {
                funder: SettlementFunder::ValidatorBond,
            },
            vote_account: payout.validator,
            claims_count: 0,
            claims_amount: 0,
            claims: vec![],
        });
        settlement.claims_count += 1;
        settlement.claims_amount += payout.payout_lamports;

        // Try to find existing claim with matching authorities
        if let Some(existing_claim) = settlement.claims.iter_mut().find(|claim| {
            claim.withdraw_authority == payout.withdrawer && claim.stake_authority == payout.staker
        }) {
            existing_claim.claim_amount += payout.payout_lamports;
            existing_claim.active_stake += payout.active_stake;
            existing_claim
                .stake_accounts
                .insert(payout.pubkey, payout.active_stake);
        } else {
            settlement.claims.push(SettlementClaim {
                withdraw_authority: payout.withdrawer,
                stake_authority: payout.staker,
                stake_accounts: HashMap::from([(payout.pubkey, payout.active_stake)]),
                active_stake: payout.active_stake,
                claim_amount: payout.payout_lamports,
            });
        }
    }

    settlements.into_values().collect()
}
