use log::{debug, info};
use settlement_common::protected_events::ProtectedEventCollection;
use settlement_common::settlement_collection::{
    Settlement, SettlementClaim, SettlementFunder, SettlementReason,
};
use settlement_common::settlement_config::{
    build_protected_event_matcher, SettlementConfig as PsrSettlementConfig,
};
use settlement_common::stake_meta_index::StakeMetaIndex;
use settlement_common::utils::sort_claims_deterministically;
use solana_sdk::pubkey::Pubkey;
use std::collections::HashMap;

/// Generates PSR settlements for protected events.
/// Takes settlement configs that match the ProtectedEvent types (DowntimeRevenueImpact, CommissionSamIncrease).
pub fn generate_psr_settlements(
    stake_meta_index: &StakeMetaIndex,
    protected_event_collection: &ProtectedEventCollection,
    stake_authority_filter: &dyn Fn(&Pubkey) -> bool,
    settlement_configs: &[PsrSettlementConfig],
) -> Vec<Settlement> {
    assert_eq!(
        stake_meta_index.stake_meta_collection.epoch, protected_event_collection.epoch,
        "Protected event collection epoch must be same as stake meta collection epoch"
    );
    assert_eq!(
        stake_meta_index.stake_meta_collection.slot,
        protected_event_collection.slot
    );

    let settlements: Vec<_> = settlement_configs
        .iter()
        .flat_map(|settlement_config| {
            generate_psr_settlements_for_config(
                stake_meta_index,
                protected_event_collection,
                stake_authority_filter,
                settlement_config,
            )
        })
        .collect();

    settlements
}

fn generate_psr_settlements_for_config(
    stake_meta_index: &StakeMetaIndex,
    protected_event_collection: &ProtectedEventCollection,
    stake_authority_filter: &dyn Fn(&Pubkey) -> bool,
    settlement_config: &PsrSettlementConfig,
) -> Vec<Settlement> {
    info!("Generating settlement claim collection type {settlement_config:?}...");

    let protected_event_matcher = build_protected_event_matcher(settlement_config);
    let matching_protected_events = protected_event_collection
        .events
        .iter()
        .filter(|event| protected_event_matcher(event));

    let mut settlement_claim_collections = vec![];

    for protected_event in matching_protected_events {
        if let Some(grouped_stake_metas) =
            stake_meta_index.iter_grouped_stake_metas(protected_event.vote_account())
        {
            let mut claims = vec![];
            let mut claims_amount = 0;
            for ((withdraw_authority, stake_authority), stake_metas) in grouped_stake_metas {
                if !stake_authority_filter(stake_authority) {
                    continue;
                }

                let stake_accounts: HashMap<_, _> = stake_metas
                    .iter()
                    .map(|s| (s.pubkey, s.active_delegation_lamports))
                    .collect();
                let active_stake = stake_accounts.values().sum();

                let claim_amount =
                    protected_event.claim_amount_in_loss_range(settlement_config, active_stake);

                if active_stake > 0 && claim_amount > 0 {
                    claims.push(SettlementClaim {
                        withdraw_authority: **withdraw_authority,
                        stake_authority: **stake_authority,
                        stake_accounts,
                        active_stake,
                        claim_amount,
                    });
                    claims_amount += claim_amount;
                }
            }

            // Adding a "NULL claim" to the claims vector
            // To distinguish between Validator and Marinade funders in cases where both are funding the same amount
            // (i.e., the Merkle root would be identical), we add a 'null' claim with a zero amount
            if settlement_config.meta().funder == SettlementFunder::Marinade {
                claims.push(SettlementClaim {
                    withdraw_authority: Pubkey::default(),
                    stake_authority: Pubkey::default(),
                    stake_accounts: HashMap::new(),
                    active_stake: 0,
                    claim_amount: 0,
                });
            }

            sort_claims_deterministically(&mut claims);

            if claims_amount >= settlement_config.min_settlement_lamports() {
                settlement_claim_collections.push(Settlement {
                    reason: SettlementReason::ProtectedEvent(Box::new(protected_event.clone())),
                    meta: settlement_config.meta().clone(),
                    vote_account: *protected_event.vote_account(),
                    claims_count: claims.len(),
                    claims_amount,
                    claims,
                    details: None,
                });
            } else {
                debug!(
                    "Skipping protected-event Settlement for vote account {} as claim amount {} is less than min settlement lamports {}",
                    protected_event.vote_account(),
                    claims_amount,
                    settlement_config.min_settlement_lamports()
                );
            }
        }
    }
    settlement_claim_collections
}
