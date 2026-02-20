use crate::settlement_collection::SettlementClaim;
use log::info;
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::{de::DeserializeOwned, Serialize};
use solana_sdk::pubkey::Pubkey;
use std::collections::HashSet;
use std::path::Path;
use std::{
    fs::File,
    io::{BufReader, BufWriter, Write},
};

pub fn write_to_json_file<T: Serialize>(data: &T, out_path: &str) -> anyhow::Result<()> {
    let file = File::create(out_path)?;
    let mut writer = BufWriter::new(file);
    let json = serde_json::to_string_pretty(data)?;
    writer.write_all(json.as_bytes())?;
    writer.flush()?;

    Ok(())
}

pub fn read_from_json_file<P: AsRef<Path>, T: DeserializeOwned>(in_path: &P) -> anyhow::Result<T> {
    let file = File::open(in_path)?;
    let reader = BufReader::new(file);
    let result: T = serde_json::from_reader(reader)?;

    Ok(result)
}

pub fn read_from_yaml_file<P: AsRef<Path>, T: DeserializeOwned>(in_path: &P) -> anyhow::Result<T> {
    let file = File::open(in_path)?;
    let reader = BufReader::new(file);
    let result: T = serde_yaml::from_reader(reader)?;

    Ok(result)
}

pub fn write_to_yaml_file<T: Serialize, P: AsRef<Path>>(
    data: &T,
    out_path: &P,
) -> anyhow::Result<()> {
    let file = File::create(out_path)?;
    let mut writer = BufWriter::new(file);
    let yaml = serde_yaml::to_string(data)?;
    writer.write_all(yaml.as_bytes())?;
    writer.flush()?;

    Ok(())
}

pub fn bps(value: u64, max: u64) -> u64 {
    assert!(max > 0, "Cannot calculate bps from values: {value}, {max}");
    10000 * value / max
}

pub fn bps_decimal(value: Decimal, max: Decimal) -> u64 {
    assert!(
        max > Decimal::ZERO,
        "Cannot calculate bps from values: {value}, {max}"
    );
    (Decimal::from(10000) * value / max)
        .to_u64()
        .expect("bps_decimal: cannot convert to u64")
}

pub fn bps_to_fraction(value: u64) -> Decimal {
    Decimal::from(value) / dec!(10000)
}

pub fn file_error<'a>(
    param_name: &'a str,
    file_path: &'a str,
) -> impl Fn(anyhow::Error) -> anyhow::Error + 'a {
    move |e| anyhow::anyhow!("Failure at '--{param_name} {file_path}': {e:?}")
}

/// Sort claims to ensure a deterministic order for identical input data
/// This guarantees the same Merkle root is generated from the same claims
pub fn sort_claims_deterministically(claims: &mut [SettlementClaim]) {
    claims.sort_by_key(|claim| {
        (
            claim.withdraw_authority,
            claim.stake_authority,
            claim.claim_amount,
        )
    });
}

fn stake_authorities_filter(whitelist: HashSet<Pubkey>) -> Box<dyn Fn(&Pubkey) -> bool> {
    Box::new(move |pubkey| whitelist.contains(pubkey))
}

fn no_filter() -> Box<dyn Fn(&Pubkey) -> bool> {
    Box::new(|_| true)
}

/// Returns a filter function for stake authorities based on an optional whitelist.
/// For `None` filter allows all stake authorities, if `Some` only those in the whitelist.
pub fn stake_authority_filter(
    optional_filter: Option<Vec<Pubkey>>,
) -> Box<dyn Fn(&Pubkey) -> bool> {
    info!("Building stake authorities filter: {optional_filter:?}");
    optional_filter.map_or(no_filter(), |filter| {
        stake_authorities_filter(HashSet::from_iter(filter))
    })
}
