use anchor_client::anchor_lang::prelude::Pubkey;
use anyhow::{anyhow, ensure};
use log::debug;
use merkle_tree::psr_claim::TreeNode;
use settlement_common::merkle_tree_collection::MerkleTreeCollection;
use settlement_common::settlement_collection::{SettlementFunder, SettlementReason};
use std::collections::HashMap;
use std::fmt;
use std::fmt::{Display, Formatter};
use std::hash::Hash;
use validator_bonds::state::bond::Bond;
use validator_bonds::state::settlement::{find_settlement_staker_authority, Settlement};

#[derive(Debug, Clone)]
pub struct SettlementRecord {
    // What epoch the settlement was created for
    pub epoch: u64,
    // Vote account the Bond account that the Settlement belongs to is staked to
    pub vote_account_address: Pubkey,
    // Bond address of the Settlement
    pub bond_address: Pubkey,
    // Bond account of the Settlement loaded on-chain
    pub bond_account: Option<Bond>,
    // Settlement address of the Settlement account
    pub settlement_address: Pubkey,
    // Settlement account loaded on-chain
    pub settlement_account: Option<Settlement>,
    // The PDA staker authority that stake accounts funded to Settlements are assigned to
    pub settlement_staker_authority: Pubkey,
    // The merkle root of the merkle tree that the settlement is based on
    pub merkle_root: [u8; 32],
    // The merkle tree nodes that the settlement is based on
    pub tree_nodes: Vec<TreeNode>,
    // The maximum total claim sum (sum of SOLs) that can be claimed from the settlement
    pub max_total_claim_sum: u64,
    // The maximum total claims (number of merkle nodes) that can be claimed from the settlement
    pub max_total_claim: u64,
    // The funder of the settlement, from the JSON file (None when loaded from merkle-tree-only)
    pub funder: SettlementFunderType,
    // The reason for the settlement (protected event, bidding...), from the JSON file (None when loaded from merkle-tree-only)
    pub reason: Option<SettlementReason>,
    // Per-funder funding amounts from the merkle tree
    pub funding_sources: HashMap<SettlementFunder, u64>,
}

/// Two SettlementRecords are equal if they are of the same bond and have the same epoch and merkle root.
/// That is implicitly derived within settlement address, see [`validator_bonds::state::settlement::find_settlement_address`].
/// While there cannot be created two `Settlement` records on-chain.
impl PartialEq for SettlementRecord {
    fn eq(&self, other: &Self) -> bool {
        self.settlement_address == other.settlement_address
    }
}

impl Hash for SettlementRecord {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.settlement_address.hash(state);
    }
}

impl Eq for SettlementRecord {}

#[derive(Debug, Clone)]
pub struct SettlementFunderValidatorBond {
    pub stake_account_to_fund: Pubkey,
}

#[derive(Debug, Clone)]
pub struct SettlementFunderMarinade {
    pub amount_to_fund: u64,
}

#[derive(Debug, Clone)]
pub enum SettlementFunderType {
    Marinade(Option<SettlementFunderMarinade>),
    ValidatorBond(Vec<SettlementFunderValidatorBond>),
}

impl SettlementFunderType {
    fn new(settlement_funder: &SettlementFunder) -> Self {
        match settlement_funder {
            SettlementFunder::Marinade => SettlementFunderType::Marinade(None),
            SettlementFunder::ValidatorBond => SettlementFunderType::ValidatorBond(vec![]),
        }
    }

    /// Determine funder type from funding_sources map.
    /// If only Marinade → Marinade funder; if only ValidatorBond → ValidatorBond funder.
    /// If mixed or empty → ValidatorBond (default).
    fn from_funding_sources(funding_sources: &HashMap<SettlementFunder, u64>) -> Self {
        let has_marinade = funding_sources
            .get(&SettlementFunder::Marinade)
            .is_some_and(|v| *v > 0);
        let has_validator_bond = funding_sources
            .get(&SettlementFunder::ValidatorBond)
            .is_some_and(|v| *v > 0);

        match (has_marinade, has_validator_bond) {
            (true, false) => SettlementFunderType::Marinade(None),
            _ => SettlementFunderType::ValidatorBond(vec![]),
        }
    }
}

impl Display for SettlementFunderType {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        match self {
            SettlementFunderType::Marinade(_) => write!(f, "Marinade"),
            SettlementFunderType::ValidatorBond(_) => write!(f, "ValidatorBond"),
        }
    }
}

/// Display helper for optional reason
pub fn reason_display(reason: &Option<SettlementReason>) -> String {
    match reason {
        Some(r) => r.to_string(),
        None => "Unknown".to_string(),
    }
}

/// Display helper for funder type
pub fn funder_display(funder: &SettlementFunderType) -> String {
    funder.to_string()
}

/// Parse settlement records from merkle tree collections only (no settlement collection needed).
/// Returns records grouped by epoch.
pub fn parse_from_merkle_tree_collections(
    merkle_tree_collections: &[MerkleTreeCollection],
    // When epoch is provided then it overrides the epoch from the merkle tree data
    epoch_override: Option<u64>,
) -> anyhow::Result<HashMap<u64, Vec<SettlementRecord>>> {
    let mut settlement_records_by_epoch: HashMap<u64, Vec<SettlementRecord>> = HashMap::new();

    for collection in merkle_tree_collections {
        let config_address = collection.validator_bonds_config;
        if config_address == Pubkey::default() {
            return Err(anyhow!(
                "No valid config address available for merkle tree collection epoch {}",
                collection.epoch,
            ));
        }

        for merkle_tree in &collection.merkle_trees {
            let merkle_root = if let Some(root) = merkle_tree.merkle_root {
                root
            } else {
                return Err(anyhow!(
                    "Cannot get settlement for vote account {} without a merkle root",
                    merkle_tree.vote_account,
                ));
            };

            let epoch = epoch_override.unwrap_or(collection.epoch);
            let vote_account_address = merkle_tree.vote_account;

            // Always derive addresses to handle epoch overrides
            // (where settlement PDA changes with epoch) and data where
            // bond_account/settlement_account default to Pubkey::default()
            let (derived_bond, _) = validator_bonds::state::bond::find_bond_address(
                &config_address,
                &vote_account_address,
            );
            let (derived_settlement, _) =
                validator_bonds::state::settlement::find_settlement_address(
                    &derived_bond,
                    &merkle_root.to_bytes(),
                    epoch,
                );

            let has_precomputed = merkle_tree.bond_account != Pubkey::default()
                && merkle_tree.settlement_account != Pubkey::default();

            if has_precomputed && epoch_override.is_none() {
                // verify derived addresses match the pre-computed ones
                debug!(
                    "Verifying addresses for vote account {vote_account_address}: bond {} == {derived_bond}, settlement {} == {derived_settlement}",
                    merkle_tree.bond_account, merkle_tree.settlement_account
                );
                ensure!(
                    merkle_tree.settlement_account == derived_settlement,
                    "Pre-computed settlement account {} does not match derived settlement {} account for vote account {:?}.",
                    merkle_tree.settlement_account, derived_settlement, vote_account_address,
                );
                ensure!(
                    merkle_tree.bond_account == derived_bond,
                    "Pre-computed bond account {} does not match derived bond account {} for vote account {:?}.",
                    merkle_tree.bond_account, derived_bond, vote_account_address
                );
            }

            let bond_address = derived_bond;
            let settlement_address = derived_settlement;

            let funder = SettlementFunderType::from_funding_sources(&merkle_tree.funding_sources);

            let record = SettlementRecord {
                epoch,
                vote_account_address,
                bond_address,
                settlement_address,
                settlement_staker_authority: find_settlement_staker_authority(&settlement_address)
                    .0,
                merkle_root: merkle_root.to_bytes(),
                tree_nodes: merkle_tree.tree_nodes.clone(),
                max_total_claim_sum: merkle_tree.max_total_claim_sum,
                max_total_claim: merkle_tree.max_total_claims as u64,
                funder,
                reason: None,
                funding_sources: merkle_tree.funding_sources.clone(),
                bond_account: None,
                settlement_account: None,
            };

            settlement_records_by_epoch
                .entry(record.epoch)
                .or_default()
                .push(record);
        }
    }

    Ok(settlement_records_by_epoch)
}

/// Splitting data loaded from JSON files into list of SettlementRecords grouped by epoch as a Map key.
/// This is the legacy pairing code for combined merkle tree + settlement collection.
#[allow(dead_code)]
pub fn parse_settlements_from_json(
    json_data: &mut [crate::json_data::CombinedMerkleTreeSettlementCollections],
    config_address: &Pubkey,
    // When epoch is provided then it overrides the epoch from the JSON data
    epoch_override: Option<u64>,
) -> anyhow::Result<HashMap<u64, Vec<SettlementRecord>>> {
    use crate::json_data::MerkleTreeMetaSettlement;

    // sorting to have the lowest epoch data first
    let combined_collections_sorted = json_data;
    combined_collections_sorted.sort_by_key(|c| c.epoch);

    let settlement_records = combined_collections_sorted
        .iter()
        .flat_map(|c| c.merkle_tree_settlements.iter().zip(std::iter::repeat(c.epoch)))
        .map(|(MerkleTreeMetaSettlement{merkle_tree, settlement}, epoch)|
            if merkle_tree.merkle_root.is_some() {
                let merkle_root = merkle_tree.merkle_root.unwrap();
                let vote_account_address = merkle_tree.vote_account;
                let (bond_address, _) = validator_bonds::state::bond::find_bond_address(
                    config_address,
                    &merkle_tree.vote_account,
                );
                let epoch = epoch_override.unwrap_or(epoch);
                let (settlement_address, _) =
                    validator_bonds::state::settlement::find_settlement_address(
                        &bond_address,
                        &merkle_root.to_bytes(),
                        epoch,
                    );
                if epoch_override.is_none() {
                    // verify settlement info created at the preparation step
                    ensure!(
                        settlement_address == merkle_tree.settlement_account,
                        "Pre-computed settlement account {} does not match derived settlement account {} for vote account {:?} and epoch {}.",
                        merkle_tree.settlement_account, settlement_address, vote_account_address, epoch
                    );
                    ensure!(
                        bond_address == merkle_tree.bond_account,
                        "Pre-computed bond account {} does not match derived bond account {} for vote account {:?} and epoch {}.",
                        merkle_tree.bond_account, bond_address, vote_account_address, epoch
                    );
                }
                let settlement_record = SettlementRecord {
                    epoch,
                    vote_account_address,
                    bond_address,
                    settlement_address,
                    settlement_staker_authority: find_settlement_staker_authority(
                        &settlement_address,
                    )
                        .0,
                    merkle_root: merkle_root.to_bytes(),
                    tree_nodes: merkle_tree.tree_nodes.clone(),
                    max_total_claim_sum: merkle_tree.max_total_claim_sum,
                    max_total_claim: merkle_tree.max_total_claims as u64,
                    funder: SettlementFunderType::new(&settlement.meta.funder),
                    reason: Some(settlement.reason.clone()),
                    funding_sources: merkle_tree.funding_sources.clone(),
                    bond_account: None,
                    settlement_account: None,
                } ;
                Ok(settlement_record)
            } else {
                Err(anyhow!(
                    "Cannot get settlement for vote account {} (reason: {:?}, funder: {:?}), epoch {} without a merkle root",
                    merkle_tree.vote_account, settlement.reason, settlement.meta.funder, epoch
                ))
            }
        )
        .collect::<anyhow::Result<Vec<SettlementRecord>>>()?;

    let mut settlement_records_by_epoch = HashMap::new();
    for record in settlement_records {
        let records = settlement_records_by_epoch
            .entry(record.epoch)
            .or_insert(vec![]);
        records.push(record);
    }
    Ok(settlement_records_by_epoch)
}
