use anyhow::{anyhow, ensure};
use log::{info, warn};
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use settlement_common::settlement_collection::{
    Settlement, SettlementCollection, SettlementProduct,
};
use solana_sdk::pubkey::Pubkey;
use std::collections::{BTreeMap, HashSet};
use std::str::FromStr;
use validator_bonds_common::dto::{BondType, ValidatorBondRecord};

pub const DEFAULT_EXPOSURE_WARNING_BPS: u64 = 2500;

const BPS: u64 = 10_000;

/// Shape of the bonds API responses (`/bonds/bidding`, `/bonds/institutional`).
#[derive(Debug, Deserialize)]
pub struct BondsFile {
    pub bonds: Vec<ValidatorBondRecord>,
}

pub struct AllocatorInput<'a> {
    pub collection: &'a SettlementCollection,
    pub bidding_bonds: &'a [ValidatorBondRecord],
    pub institutional_bonds: &'a [ValidatorBondRecord],
    pub evaluated_vote_accounts: &'a HashSet<Pubkey>,
    pub expect_slot: u64,
    pub exposure_warning_bps: u64,
}

#[derive(Debug)]
pub struct AllocatorOutput {
    pub bidding: SettlementCollection,
    pub institutional: SettlementCollection,
    pub report: AllocationReport,
}

#[derive(Debug, Serialize)]
pub struct AllocationReport {
    pub epoch: u64,
    pub slot: u64,
    pub totals: ReportTotals,
    pub routed: Vec<RoutedValidator>,
    pub dropped_no_usable_bond: Vec<DroppedValidator>,
    pub exposure_warnings: Vec<ExposureWarning>,
    /// Bond snapshots are resolved per bond type, so the two files can legitimately differ by an epoch.
    pub bidding_bonds_epoch: Option<u64>,
    pub institutional_bonds_epoch: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct ReportTotals {
    pub settlements_in: usize,
    pub claims_amount_in: u64,
    pub bidding_settlements: usize,
    pub bidding_claims_amount: u64,
    pub institutional_settlements: usize,
    pub institutional_claims_amount: u64,
    pub dropped_settlements: usize,
    pub dropped_claims_amount: u64,
}

#[derive(Debug, Serialize)]
pub struct RoutedValidator {
    pub vote_account: String,
    pub bond_type: String,
    pub settlements: usize,
    pub claims_amount: u64,
    pub effective_amount: String,
    pub exposure_bps: u64,
}

#[derive(Debug, Serialize)]
pub struct DroppedValidator {
    pub vote_account: String,
    pub settlements: usize,
    pub claims_amount: u64,
    pub bidding_effective_amount: String,
    pub institutional_effective_amount: String,
}

#[derive(Debug, Serialize)]
pub struct ExposureWarning {
    pub vote_account: String,
    pub bond_type: String,
    pub claims_amount: u64,
    pub effective_amount: String,
    pub exposure_bps: u64,
    pub threshold_bps: u64,
}

/// Splits a direct-staking settlement collection into one collection per bond config, keeping only
/// validators whose chosen bond can actually pay. Pure: same inputs give byte-identical outputs.
pub fn allocate(input: AllocatorInput) -> anyhow::Result<AllocatorOutput> {
    ensure!(
        input.collection.slot == input.expect_slot,
        "settlement collection slot {} does not match the expected snapshot slot {}: different slots mean different stake snapshots",
        input.collection.slot,
        input.expect_slot
    );

    let bidding_effective = effective_amounts(input.bidding_bonds, BondType::Bidding)?;
    let institutional_effective =
        effective_amounts(input.institutional_bonds, BondType::Institutional)?;

    let mut per_vote_account: BTreeMap<Pubkey, Vec<&Settlement>> = BTreeMap::new();
    for settlement in &input.collection.settlements {
        per_vote_account
            .entry(settlement.vote_account)
            .or_default()
            .push(settlement);
    }

    let mut chosen_bond: BTreeMap<Pubkey, BondType> = BTreeMap::new();
    let mut bidding_settlements: Vec<Settlement> = vec![];
    let mut institutional_settlements: Vec<Settlement> = vec![];
    let mut routed: Vec<RoutedValidator> = vec![];
    let mut dropped: Vec<DroppedValidator> = vec![];
    let mut exposure_warnings: Vec<ExposureWarning> = vec![];

    let bidding_bonds_epoch = bonds_epoch(input.bidding_bonds);
    let institutional_bonds_epoch = bonds_epoch(input.institutional_bonds);
    if let (Some(bidding), Some(institutional)) = (bidding_bonds_epoch, institutional_bonds_epoch) {
        if bidding != institutional {
            warn!("Bond snapshots disagree: bidding is epoch {bidding}, institutional is epoch {institutional}; a stale snapshot routes validators to the other config");
        }
    }

    for (vote_account, settlements) in per_vote_account {
        let claims_amount: u64 = settlements.iter().map(|s| s.claims_amount).sum();
        let bidding_amount = bidding_effective
            .get(&vote_account)
            .copied()
            .unwrap_or_default();
        let institutional_amount = institutional_effective
            .get(&vote_account)
            .copied()
            .unwrap_or_default();

        // a downtime event cannot exist without a revenue expectation, so this can only mean the
        // generator and the allocator were handed different evaluation.json files
        ensure!(
            input.evaluated_vote_accounts.contains(&vote_account),
            "vote account {vote_account} carries direct-staking settlements but has no revenue expectation: bid-distribution-cli and the allocator must read the same evaluation.json"
        );

        // SAM config first, but only while its bond covers the obligation: a token bidding bond must
        // not capture claims a funded institutional bond would pay in full. When neither covers, the
        // larger bond still takes them — dropping would pay the stakers nothing at all.
        let obligation = Decimal::from(claims_amount);
        let covers = |amount: Decimal| amount > Decimal::ZERO && amount >= obligation;
        let routing = if covers(bidding_amount) {
            Some((BondType::Bidding, bidding_amount))
        } else if covers(institutional_amount) {
            Some((BondType::Institutional, institutional_amount))
        } else if bidding_amount > Decimal::ZERO && bidding_amount >= institutional_amount {
            Some((BondType::Bidding, bidding_amount))
        } else if institutional_amount > Decimal::ZERO {
            Some((BondType::Institutional, institutional_amount))
        } else {
            None
        };

        let Some((bond_type, effective_amount)) = routing else {
            warn!(
                "Dropping {} direct-staking settlement(s) for vote account {vote_account}: no usable bond ({claims_amount} lamports unprotected)",
                settlements.len()
            );
            dropped.push(DroppedValidator {
                vote_account: vote_account.to_string(),
                settlements: settlements.len(),
                claims_amount,
                bidding_effective_amount: bidding_amount.to_string(),
                institutional_effective_amount: institutional_amount.to_string(),
            });
            continue;
        };

        let exposure_bps = exposure_bps(claims_amount, effective_amount);
        if exceeds_exposure(claims_amount, effective_amount, input.exposure_warning_bps) {
            warn!(
                "Vote account {vote_account} owes {claims_amount} lamports of direct-staking PSR against an effective bond of {effective_amount} ({exposure_bps} bps)"
            );
            exposure_warnings.push(ExposureWarning {
                vote_account: vote_account.to_string(),
                bond_type: bond_type.as_str().to_string(),
                claims_amount,
                effective_amount: effective_amount.to_string(),
                exposure_bps,
                threshold_bps: input.exposure_warning_bps,
            });
        }

        routed.push(RoutedValidator {
            vote_account: vote_account.to_string(),
            bond_type: bond_type.as_str().to_string(),
            settlements: settlements.len(),
            claims_amount,
            effective_amount: effective_amount.to_string(),
            exposure_bps,
        });

        chosen_bond.insert(vote_account, bond_type);
    }

    // Emitted in input order so each output reads back as a plain subset of the source collection.
    for settlement in &input.collection.settlements {
        let Some(bond_type) = chosen_bond.get(&settlement.vote_account) else {
            continue;
        };
        let mut stamped = settlement.clone();
        stamped.product = Some(SettlementProduct::SingleValidator);
        match bond_type {
            BondType::Bidding => bidding_settlements.push(stamped),
            BondType::Institutional => institutional_settlements.push(stamped),
        }
    }

    let totals = ReportTotals {
        settlements_in: input.collection.settlements.len(),
        claims_amount_in: input
            .collection
            .settlements
            .iter()
            .map(|s| s.claims_amount)
            .sum(),
        bidding_settlements: bidding_settlements.len(),
        bidding_claims_amount: bidding_settlements.iter().map(|s| s.claims_amount).sum(),
        institutional_settlements: institutional_settlements.len(),
        institutional_claims_amount: institutional_settlements
            .iter()
            .map(|s| s.claims_amount)
            .sum(),
        dropped_settlements: dropped.iter().map(|d| d.settlements).sum(),
        dropped_claims_amount: dropped.iter().map(|d| d.claims_amount).sum(),
    };
    ensure!(
        totals.bidding_claims_amount
            + totals.institutional_claims_amount
            + totals.dropped_claims_amount
            == totals.claims_amount_in,
        "routing lost lamports: {} + {} + {} != {}",
        totals.bidding_claims_amount,
        totals.institutional_claims_amount,
        totals.dropped_claims_amount,
        totals.claims_amount_in
    );

    info!(
        "Routed {} settlements: {} bidding ({} lamports), {} institutional ({} lamports), {} dropped ({} lamports)",
        totals.settlements_in,
        totals.bidding_settlements,
        totals.bidding_claims_amount,
        totals.institutional_settlements,
        totals.institutional_claims_amount,
        totals.dropped_settlements,
        totals.dropped_claims_amount
    );

    Ok(AllocatorOutput {
        bidding: derive_collection(input.collection, bidding_settlements),
        institutional: derive_collection(input.collection, institutional_settlements),
        report: AllocationReport {
            epoch: input.collection.epoch,
            slot: input.collection.slot,
            totals,
            routed,
            dropped_no_usable_bond: dropped,
            exposure_warnings,
            bidding_bonds_epoch,
            institutional_bonds_epoch,
        },
    })
}

fn derive_collection(
    source: &SettlementCollection,
    settlements: Vec<Settlement>,
) -> SettlementCollection {
    SettlementCollection {
        slot: source.slot,
        epoch: source.epoch,
        settlements,
        adj_max_fee_bps: source.adj_max_fee_bps,
        adj_min_fee_bps: source.adj_min_fee_bps,
        ssr_pmpe: source.ssr_pmpe,
    }
}

fn effective_amounts(
    records: &[ValidatorBondRecord],
    expected_type: BondType,
) -> anyhow::Result<BTreeMap<Pubkey, Decimal>> {
    let mut amounts = BTreeMap::new();
    for record in records {
        ensure!(
            record.bond_type.as_str() == expected_type.as_str(),
            "expected only {} bonds but vote account {} is {}",
            expected_type.as_str(),
            record.vote_account,
            record.bond_type.as_str()
        );
        let vote_account = Pubkey::from_str(&record.vote_account).map_err(|e| {
            anyhow!(
                "bond {} has an unparseable vote account {}: {e}",
                record.pubkey,
                record.vote_account
            )
        })?;
        ensure!(
            amounts
                .insert(vote_account, record.effective_amount)
                .is_none(),
            "{} bonds list vote account {vote_account} more than once",
            expected_type.as_str()
        );
    }
    Ok(amounts)
}

fn bonds_epoch(records: &[ValidatorBondRecord]) -> Option<u64> {
    records.iter().map(|record| record.epoch).max()
}

fn exceeds_exposure(claims_amount: u64, effective_amount: Decimal, threshold_bps: u64) -> bool {
    Decimal::from(claims_amount) * Decimal::from(BPS)
        > effective_amount * Decimal::from(threshold_bps)
}

/// Share of the bond this product alone claims; the epoch's SAM claims on the same bond are invisible here.
fn exposure_bps(claims_amount: u64, effective_amount: Decimal) -> u64 {
    if effective_amount <= Decimal::ZERO {
        return u64::MAX;
    }
    (Decimal::from(claims_amount) * Decimal::from(BPS) / effective_amount)
        .ceil()
        .to_u64()
        .unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use rust_decimal_macros::dec;
    use settlement_common::protected_events::ProtectedEvent;
    use settlement_common::settlement_collection::{SettlementFunder, SettlementReason};

    const SLOT: u64 = 423_791_999;
    const EPOCH: u64 = 980;

    fn vote_account(seed: u8) -> Pubkey {
        let mut bytes = [0u8; 32];
        bytes[0] = seed;
        Pubkey::new_from_array(bytes)
    }

    fn downtime_settlement(vote: Pubkey, claims_amount: u64) -> Settlement {
        Settlement {
            reason: SettlementReason::ProtectedEvent(Box::new(
                ProtectedEvent::DowntimeRevenueImpact {
                    vote_account: vote,
                    actual_credits: 0,
                    expected_credits: 10_000,
                    expected_epr: dec!(0.001),
                    actual_epr: Decimal::ZERO,
                    epr_loss_bps: 10_000,
                    stake: claims_amount * 1_000,
                },
            )),
            funder: SettlementFunder::ValidatorBond,
            vote_account: vote,
            claims_count: 1,
            claims_amount,
            claims: vec![],
            details: None,
            product: None,
        }
    }

    fn collection(settlements: Vec<Settlement>) -> SettlementCollection {
        SettlementCollection {
            slot: SLOT,
            epoch: EPOCH,
            settlements,
            adj_max_fee_bps: None,
            adj_min_fee_bps: None,
            ssr_pmpe: None,
        }
    }

    fn bond(vote: Pubkey, effective_amount: Decimal, bond_type: BondType) -> ValidatorBondRecord {
        ValidatorBondRecord {
            pubkey: Pubkey::new_unique().to_string(),
            vote_account: vote.to_string(),
            authority: Pubkey::new_unique().to_string(),
            cpmpe: Decimal::ZERO,
            max_stake_wanted: Decimal::ZERO,
            epoch: EPOCH,
            funded_amount: effective_amount,
            effective_amount,
            remaining_witdraw_request_amount: Decimal::ZERO,
            remainining_settlement_claim_amount: Decimal::ZERO,
            updated_at: Utc::now(),
            bond_type,
            inflation_commission_bps: None,
            mev_commission_bps: None,
            block_commission_bps: None,
        }
    }

    fn run(
        collection: &SettlementCollection,
        bidding: &[ValidatorBondRecord],
        institutional: &[ValidatorBondRecord],
    ) -> AllocatorOutput {
        let evaluated: HashSet<Pubkey> = collection
            .settlements
            .iter()
            .map(|s| s.vote_account)
            .collect();
        allocate(AllocatorInput {
            collection,
            bidding_bonds: bidding,
            institutional_bonds: institutional,
            evaluated_vote_accounts: &evaluated,
            expect_slot: SLOT,
            exposure_warning_bps: DEFAULT_EXPOSURE_WARNING_BPS,
        })
        .unwrap()
    }

    #[test]
    fn only_bidding_bond_routes_to_bidding() {
        let vote = vote_account(1);
        let input = collection(vec![downtime_settlement(vote, 1_000)]);
        let out = run(&input, &[bond(vote, dec!(1000000), BondType::Bidding)], &[]);

        assert_eq!(out.bidding.settlements.len(), 1);
        assert!(out.institutional.settlements.is_empty());
        assert_eq!(out.report.routed[0].bond_type, "bidding");
        assert_eq!(
            out.bidding.settlements[0].product,
            Some(SettlementProduct::SingleValidator)
        );
    }

    #[test]
    fn only_institutional_bond_routes_to_institutional() {
        let vote = vote_account(1);
        let input = collection(vec![downtime_settlement(vote, 1_000)]);
        let out = run(
            &input,
            &[],
            &[bond(vote, dec!(1000000), BondType::Institutional)],
        );

        assert!(out.bidding.settlements.is_empty());
        assert_eq!(out.institutional.settlements.len(), 1);
        assert_eq!(out.report.routed[0].bond_type, "institutional");
        assert_eq!(
            out.institutional.settlements[0].product,
            Some(SettlementProduct::SingleValidator)
        );
    }

    #[test]
    fn both_bonds_usable_prefers_bidding() {
        let vote = vote_account(1);
        let input = collection(vec![downtime_settlement(vote, 1_000)]);
        let out = run(
            &input,
            &[bond(vote, dec!(5000), BondType::Bidding)],
            &[bond(vote, dec!(1000000), BondType::Institutional)],
        );

        assert_eq!(
            out.bidding.settlements.len(),
            1,
            "SAM config is primary even when institutional holds more"
        );
        assert!(out.institutional.settlements.is_empty());
    }

    #[test]
    fn a_bond_exactly_covering_the_obligation_is_used() {
        let vote = vote_account(1);
        let input = collection(vec![downtime_settlement(vote, 1_000)]);
        let out = run(
            &input,
            &[bond(vote, dec!(1000), BondType::Bidding)],
            &[bond(vote, dec!(1000000), BondType::Institutional)],
        );

        assert_eq!(
            out.bidding.settlements.len(),
            1,
            "covering the obligation exactly is enough to keep the SAM preference"
        );
    }

    #[test]
    fn token_bidding_bond_does_not_capture_claims_the_institutional_bond_covers() {
        let vote = vote_account(1);
        let input = collection(vec![downtime_settlement(vote, 1_000)]);
        let out = run(
            &input,
            &[bond(vote, dec!(1), BondType::Bidding)],
            &[bond(vote, dec!(1000000), BondType::Institutional)],
        );

        assert!(
            out.bidding.settlements.is_empty(),
            "a bond that cannot pay must not win the SAM preference"
        );
        assert_eq!(out.institutional.settlements.len(), 1);
        assert!(out.report.dropped_no_usable_bond.is_empty());
    }

    #[test]
    fn when_neither_bond_covers_the_larger_bidding_bond_is_used() {
        let vote = vote_account(1);
        let input = collection(vec![downtime_settlement(vote, 1_000)]);
        let out = run(
            &input,
            &[bond(vote, dec!(400), BondType::Bidding)],
            &[bond(vote, dec!(300), BondType::Institutional)],
        );

        assert_eq!(out.bidding.settlements.len(), 1);
        assert!(
            out.report.dropped_no_usable_bond.is_empty(),
            "an underfunded bond still pays what it can, dropping would pay the stakers nothing"
        );
    }

    #[test]
    fn when_neither_bond_covers_the_larger_institutional_bond_is_used() {
        let vote = vote_account(1);
        let input = collection(vec![downtime_settlement(vote, 1_000)]);
        let out = run(
            &input,
            &[bond(vote, dec!(300), BondType::Bidding)],
            &[bond(vote, dec!(400), BondType::Institutional)],
        );

        assert!(out.bidding.settlements.is_empty());
        assert_eq!(out.institutional.settlements.len(), 1);
        assert!(out.report.dropped_no_usable_bond.is_empty());
    }

    #[test]
    fn funded_but_zero_effective_is_dropped() {
        let vote = vote_account(1);
        let input = collection(vec![downtime_settlement(vote, 1_000)]);
        let mut funded = bond(vote, Decimal::ZERO, BondType::Bidding);
        funded.funded_amount = dec!(4574317);
        let out = run(&input, &[funded], &[]);

        assert!(out.bidding.settlements.is_empty());
        assert!(out.institutional.settlements.is_empty());
        assert_eq!(out.report.dropped_no_usable_bond.len(), 1);
        assert_eq!(out.report.dropped_no_usable_bond[0].claims_amount, 1_000);
    }

    #[test]
    fn no_bond_at_all_is_dropped() {
        let vote = vote_account(1);
        let input = collection(vec![downtime_settlement(vote, 1_000)]);
        let out = run(&input, &[], &[]);

        assert_eq!(out.report.dropped_no_usable_bond.len(), 1);
        assert_eq!(out.report.totals.dropped_claims_amount, 1_000);
        assert_eq!(out.report.totals.bidding_claims_amount, 0);
    }

    #[test]
    fn settlements_for_an_unevaluated_validator_are_rejected() {
        let vote = vote_account(1);
        let input = collection(vec![downtime_settlement(vote, 1_000)]);
        let error = allocate(AllocatorInput {
            collection: &input,
            bidding_bonds: &[bond(vote, dec!(1000000), BondType::Bidding)],
            institutional_bonds: &[],
            evaluated_vote_accounts: &HashSet::new(),
            expect_slot: SLOT,
            exposure_warning_bps: DEFAULT_EXPOSURE_WARNING_BPS,
        })
        .expect_err("a settlement without a revenue expectation means mismatched evaluation files")
        .to_string();

        assert!(error.contains(&vote.to_string()), "{error}");
        assert!(error.contains("same evaluation.json"), "{error}");
    }

    #[test]
    fn bond_snapshots_of_different_epochs_are_reported() {
        let vote = vote_account(1);
        let input = collection(vec![downtime_settlement(vote, 1_000)]);
        let mut stale = bond(vote, dec!(1000000), BondType::Bidding);
        stale.epoch = EPOCH - 1;
        let out = run(
            &input,
            &[stale],
            &[bond(vote, dec!(1000000), BondType::Institutional)],
        );

        assert_eq!(out.report.bidding_bonds_epoch, Some(EPOCH - 1));
        assert_eq!(out.report.institutional_bonds_epoch, Some(EPOCH));
        assert_eq!(
            out.bidding.settlements.len(),
            1,
            "a skewed snapshot is reported, it does not change routing"
        );
    }

    #[test]
    fn exposure_warning_fires_only_above_the_threshold() {
        let vote = vote_account(1);
        let input = collection(vec![downtime_settlement(vote, 2_500)]);

        // 2_500 of 10_000 is exactly 2500 bps, the threshold is not exceeded
        let at_threshold = run(&input, &[bond(vote, dec!(10000), BondType::Bidding)], &[]);
        assert!(at_threshold.report.exposure_warnings.is_empty());
        assert_eq!(at_threshold.report.routed[0].exposure_bps, 2_500);

        let above = run(&input, &[bond(vote, dec!(9999), BondType::Bidding)], &[]);
        assert_eq!(above.report.exposure_warnings.len(), 1);
        assert_eq!(above.report.exposure_warnings[0].threshold_bps, 2_500);
        assert!(
            above.report.exposure_warnings[0].exposure_bps > 2_500,
            "a warned exposure must never be reported as low as its own threshold"
        );
    }

    #[test]
    fn empty_input_yields_valid_empty_collections() {
        let input = collection(vec![]);
        let out = run(&input, &[], &[]);

        assert!(out.bidding.settlements.is_empty());
        assert!(out.institutional.settlements.is_empty());
        assert_eq!(out.bidding.slot, SLOT);
        assert_eq!(out.bidding.epoch, EPOCH);
        assert_eq!(out.institutional.slot, SLOT);
        assert_eq!(out.institutional.epoch, EPOCH);
        assert_eq!(out.report.totals.settlements_in, 0);
    }

    #[test]
    fn routing_is_deterministic_and_splits_without_loss() {
        let votes: Vec<Pubkey> = (1..=6).map(vote_account).collect();
        let input = collection(
            votes
                .iter()
                .enumerate()
                .map(|(i, v)| downtime_settlement(*v, 1_000 * (i as u64 + 1)))
                .collect(),
        );
        let bidding: Vec<ValidatorBondRecord> = votes
            .iter()
            .take(2)
            .map(|v| bond(*v, dec!(1000000), BondType::Bidding))
            .collect();
        let institutional: Vec<ValidatorBondRecord> = votes
            .iter()
            .skip(2)
            .take(2)
            .map(|v| bond(*v, dec!(1000000), BondType::Institutional))
            .collect();

        let first = run(&input, &bidding, &institutional);
        let second = run(&input, &bidding, &institutional);

        assert_eq!(
            serde_json::to_string(&first.bidding).unwrap(),
            serde_json::to_string(&second.bidding).unwrap()
        );
        assert_eq!(
            serde_json::to_string(&first.institutional).unwrap(),
            serde_json::to_string(&second.institutional).unwrap()
        );
        assert_eq!(first.bidding.settlements.len(), 2);
        assert_eq!(first.institutional.settlements.len(), 2);
        assert_eq!(first.report.dropped_no_usable_bond.len(), 2);
        assert_eq!(
            first.report.totals.bidding_claims_amount
                + first.report.totals.institutional_claims_amount
                + first.report.totals.dropped_claims_amount,
            first.report.totals.claims_amount_in
        );
        let no_overlap = first.bidding.settlements.iter().all(|b| {
            !first
                .institutional
                .settlements
                .iter()
                .any(|i| i.vote_account == b.vote_account)
        });
        assert!(no_overlap, "a validator must land in exactly one config");
    }

    #[test]
    fn slot_mismatch_is_rejected() {
        let vote = vote_account(1);
        let input = collection(vec![downtime_settlement(vote, 1_000)]);
        let evaluated: HashSet<Pubkey> = HashSet::from([vote]);
        let result = allocate(AllocatorInput {
            collection: &input,
            bidding_bonds: &[bond(vote, dec!(1000000), BondType::Bidding)],
            institutional_bonds: &[],
            evaluated_vote_accounts: &evaluated,
            expect_slot: SLOT + 1,
            exposure_warning_bps: DEFAULT_EXPOSURE_WARNING_BPS,
        });

        let error = result.unwrap_err().to_string();
        assert!(
            error.contains("different slots mean different stake snapshots"),
            "{error}"
        );
    }

    #[test]
    fn bonds_file_of_the_wrong_config_is_rejected() {
        let vote = vote_account(1);
        let input = collection(vec![downtime_settlement(vote, 1_000)]);
        let evaluated: HashSet<Pubkey> = HashSet::from([vote]);
        let result = allocate(AllocatorInput {
            collection: &input,
            bidding_bonds: &[bond(vote, dec!(1000000), BondType::Institutional)],
            institutional_bonds: &[],
            evaluated_vote_accounts: &evaluated,
            expect_slot: SLOT,
            exposure_warning_bps: DEFAULT_EXPOSURE_WARNING_BPS,
        });

        assert!(result
            .unwrap_err()
            .to_string()
            .contains("expected only bidding bonds"));
    }

    #[test]
    fn duplicate_bond_for_one_vote_account_is_rejected() {
        let vote = vote_account(1);
        let input = collection(vec![downtime_settlement(vote, 1_000)]);
        let evaluated: HashSet<Pubkey> = HashSet::from([vote]);
        let result = allocate(AllocatorInput {
            collection: &input,
            bidding_bonds: &[
                bond(vote, dec!(1000000), BondType::Bidding),
                bond(vote, dec!(2000000), BondType::Bidding),
            ],
            institutional_bonds: &[],
            evaluated_vote_accounts: &evaluated,
            expect_slot: SLOT,
            exposure_warning_bps: DEFAULT_EXPOSURE_WARNING_BPS,
        });

        assert!(result.unwrap_err().to_string().contains("more than once"));
    }

    #[test]
    fn several_settlements_of_one_validator_route_together() {
        let vote = vote_account(1);
        let input = collection(vec![
            downtime_settlement(vote, 1_000),
            downtime_settlement(vote, 2_000),
        ]);
        let out = run(&input, &[bond(vote, dec!(1000000), BondType::Bidding)], &[]);

        assert_eq!(out.bidding.settlements.len(), 2);
        assert_eq!(out.report.routed.len(), 1);
        assert_eq!(out.report.routed[0].settlements, 2);
        assert_eq!(out.report.routed[0].claims_amount, 3_000);
    }

    #[test]
    fn output_keeps_the_input_settlement_order() {
        let (first, second) = (vote_account(9), vote_account(2));
        let input = collection(vec![
            downtime_settlement(first, 1_000),
            downtime_settlement(second, 2_000),
        ]);
        let out = run(
            &input,
            &[
                bond(first, dec!(1000000), BondType::Bidding),
                bond(second, dec!(1000000), BondType::Bidding),
            ],
            &[],
        );

        assert_eq!(
            out.bidding
                .settlements
                .iter()
                .map(|s| s.vote_account)
                .collect::<Vec<_>>(),
            vec![first, second],
            "the output must stay a subset of the input, not a re-sorted copy"
        );
    }

    #[test]
    fn bonds_file_deserializes_from_the_api_shape() {
        let json = r#"{"bonds":[{
            "pubkey":"C6HtYb5UzyFVYfKFj5jxs1sVcfoDdyMeuwWcrxFgtnh1",
            "vote_account":"gridZ5cMHjWGktAQt6o36NtF7XSv19nJBrW83zmo7BM",
            "authority":"gridqZmeBcsUKT2Mv4M9YFHFN3tVLFb2TCtTcLD1cAd",
            "cpmpe":0.0,"max_stake_wanted":0.0,"epoch":1011,
            "funded_amount":30111899570.0,"effective_amount":29784659470.0,
            "remaining_witdraw_request_amount":0.0,
            "remainining_settlement_claim_amount":327240100.0,
            "updated_at":"2026-08-04T12:17:37.445346Z","bond_type":"institutional",
            "inflation_commission_bps":null,"mev_commission_bps":null,"block_commission_bps":null
        }]}"#;

        let parsed: BondsFile = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.bonds.len(), 1);
        assert_eq!(parsed.bonds[0].effective_amount, dec!(29784659470));
        assert_eq!(parsed.bonds[0].bond_type.as_str(), "institutional");
    }
}
