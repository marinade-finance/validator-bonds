use crate::json_data::{CombinedMerkleTreeSettlementCollections, MerkleTreeMetaSettlement};
use anchor_client::anchor_lang::prelude::Pubkey;
use anyhow::anyhow;
use merkle_tree::psr_claim::TreeNode;
use protected_event_distribution::settlement_claims::{SettlementFunder, SettlementReason};
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
    // The funder of the settlement, from the JSON file
    pub funder: SettlementFunderType,
    // The reason for the settlement (protected event, bidding...), from the JSON file
    pub reason: SettlementReason,
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
}

impl Display for SettlementFunderType {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        match self {
            SettlementFunderType::Marinade(_) => write!(f, "Marinade"),
            SettlementFunderType::ValidatorBond(_) => write!(f, "ValidatorBond"),
        }
    }
}

/// Splitting data loaded from JSON files into list of SettlementRecords grouped by epoch as a Map key.
/// We expect the JSON data was combination of two different sources (merkle tree and settlement)
/// and they were loaded with [crate::json_data::load_json].
pub fn parse_settlements_from_json(
    json_data: &mut [CombinedMerkleTreeSettlementCollections],
    config_address: &Pubkey,
    // When epoch is provided then it overrides the epoch from the JSON data
    epoch_override: Option<u64>,
) -> anyhow::Result<HashMap<u64, Vec<SettlementRecord>>> {
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
                    reason: settlement.reason.clone(),
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
