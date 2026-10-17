use crate::repositories::bond::collected_bonds;
use chrono::{TimeZone, Utc};
use rust_decimal::Decimal;
use validator_bonds_common::dto::{BondType, ValidatorBondRecord};

fn bond(epoch: u64, bond_type: BondType) -> ValidatorBondRecord {
    ValidatorBondRecord {
        pubkey: "8BopghjQ763ya26YPXSka3eLneU4ENdYMtjtzDLGsMrn".to_owned(),
        vote_account: "We11J5D4iXcNbdMwCZX2o9RRkwaWBo1AGLADfubmeTb".to_owned(),
        authority: "Py1iUEHc6YvkotpA1sjxXBAyBgGJDbQiEnApwse1cTq".to_owned(),
        cpmpe: Decimal::ZERO,
        max_stake_wanted: Decimal::ZERO,
        epoch,
        funded_amount: Decimal::ZERO,
        effective_amount: Decimal::ZERO,
        remaining_witdraw_request_amount: Decimal::ZERO,
        remainining_settlement_claim_amount: Decimal::ZERO,
        updated_at: Utc
            .with_ymd_and_hms(2026, 8, 10, 12, 0, 0)
            .single()
            .expect("a fixed valid timestamp"),
        bond_type,
        inflation_commission_bps: None,
        mev_commission_bps: None,
        block_commission_bps: None,
    }
}

#[test]
fn the_epoch_and_the_type_are_the_path() {
    let (path, document) = collected_bonds(vec![
        bond(1014, BondType::Institutional),
        bond(1014, BondType::Institutional),
    ])
    .expect("one epoch of one type is storable");
    assert_eq!(path, "/bonds/institutional/1014");
    assert_eq!(document.epoch, 1014);
    assert_eq!(document.bonds.len(), 2);
}

#[test]
fn an_empty_collection_is_rejected() {
    let err = collected_bonds(vec![]).expect_err("an empty file must not empty the store");
    assert!(err.to_string().contains("No bonds"));
}

#[test]
fn mixed_epochs_are_rejected() {
    let err = collected_bonds(vec![
        bond(1014, BondType::Bidding),
        bond(1013, BondType::Bidding),
    ])
    .expect_err("two epochs have no one path");
    assert!(err.to_string().contains("multiple epochs"));
}

#[test]
fn mixed_bond_types_are_rejected() {
    let err = collected_bonds(vec![
        bond(1014, BondType::Bidding),
        bond(1014, BondType::Institutional),
    ])
    .expect_err("two types have no one path");
    assert!(err.to_string().contains("multiple bond types"));
}
