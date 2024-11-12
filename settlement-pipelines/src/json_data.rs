use crate::cli_result::CliError;
use crate::settlement_data::{parse_settlements_from_json, SettlementRecord};
use anchor_client::anchor_lang::prelude::Pubkey;
use anyhow::anyhow;
use log::{debug, error, info};
use merkle_tree::serde_serialize::pubkey_string_conversion;
use protected_event_distribution::merkle_tree_collection::{MerkleTreeCollection, MerkleTreeMeta};
use protected_event_distribution::settlement_claims::{Settlement, SettlementCollection};
use protected_event_distribution::utils::read_from_json_file;
use serde::{Deserialize, Serialize};
use solana_client::nonblocking::rpc_client::RpcClient;
use std::collections::{HashMap, HashSet};
use std::fmt::Debug;
use std::path::PathBuf;
use std::sync::Arc;
use validator_bonds::state::bond::Bond;
use validator_bonds::state::settlement::Settlement as SettlementContract;
use validator_bonds_common::bonds::get_bonds_for_pubkeys;
use validator_bonds_common::settlements::get_settlements_for_pubkeys;

/// For Closing and Listing settlements
/// This is a transfer data format that the `list-settlement` command uses to save data to.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BondSettlement {
    #[serde(with = "pubkey_string_conversion")]
    pub bond_address: Pubkey,
    #[serde(with = "pubkey_string_conversion")]
    pub vote_account_address: Pubkey,
    #[serde(with = "pubkey_string_conversion")]
    pub settlement_address: Pubkey,
    pub epoch: u64,
    pub merkle_root: [u8; 32],
}

/// For Funding and Claiming settlements
#[derive(Clone)]
pub struct MerkleTreeMetaSettlement {
    pub merkle_tree: MerkleTreeMeta,
    pub settlement: Settlement,
}
#[derive(Clone)]
pub struct CombinedMerkleTreeSettlementCollections {
    pub slot: u64,
    pub epoch: u64,
    pub merkle_tree_settlements: Vec<MerkleTreeMetaSettlement>,
}

/// Load JSON data from pairs of files expecting one file is of `settlement.json` and the other is `merkle-tree.json`.
/// Returns a collection of data combined from both files and containing information about epoch.
pub fn load_json(
    settlement_json_files: &[PathBuf],
) -> anyhow::Result<Vec<CombinedMerkleTreeSettlementCollections>> {
    // make pairs of files from settlement_json_files
    let settlement_json_files_pairs = pair_elements(settlement_json_files)?;
    // loading data from a pair of files, every pair has to consist of one settlement and one merkle tree file
    let mut claiming_data: Vec<CombinedMerkleTreeSettlementCollections> = vec![];
    for (path1, path2) in settlement_json_files_pairs.iter().filter(|(path1, path2)| {
        if check_is_file(path1) && check_is_file(path2) {
            true
        } else {
            error!(
                "Skipping '{:?}' and '{:?}' as one or both are not correct file paths",
                path1, path2
            );
            false
        }
    }) {
        let mut loaded_merkle_tree: MerkleTreeSettlementLoadedData =
            MerkleTreeSettlementLoadedData::default();
        load_json_merkle_tree_settlement(path1, &mut loaded_merkle_tree)?;
        load_json_merkle_tree_settlement(path2, &mut loaded_merkle_tree)?;
        claiming_data.push(resolve_combined_optional(loaded_merkle_tree)?);
    }
    claiming_data.sort_by_key(|c| c.epoch);

    info!(
        "Loaded json data from {:?} with {} records for epochs: {:?}",
        settlement_json_files_pairs
            .iter()
            .map(|(p1, p2)| format!("<{},{}>", p1.to_str().unwrap(), p2.to_str().unwrap()))
            .collect::<Vec<_>>(),
        claiming_data
            .iter()
            .map(|v| v.merkle_tree_settlements.len())
            .sum::<usize>(),
        // deduplicate and sort the epochs
        claiming_data
            .iter()
            .map(|v| v.epoch)
            .collect::<HashSet<u64>>() // deduplicate
    );
    Ok(claiming_data)
}

#[derive(Default)]
struct MerkleTreeSettlementLoadedData {
    merkle_tree_collection: Option<MerkleTreeCollection>,
    settlement_collection: Option<SettlementCollection>,
}

fn insert_json_parsed_data(
    loaded_data: &mut MerkleTreeSettlementLoadedData,
    merkle_tree_collection: Option<MerkleTreeCollection>,
    settlement_collection: Option<SettlementCollection>,
) -> anyhow::Result<()> {
    // Get the epoch and handle mismatches
    match (&merkle_tree_collection, &settlement_collection) {
        (Some(mc), Some(sc)) if mc.epoch != sc.epoch => {
            return Err(CliError::critical(format!(
                "Epoch mismatch between merkle tree collection and settlement collection: {} != {}",
                mc.epoch, sc.epoch
            )));
        }
        (Some(mc), _) => mc.epoch,
        (_, Some(sc)) => sc.epoch,
        _ => {
            return Err(CliError::critical(
                "No epoch found in either merkle tree collection or settlement collection",
            ));
        }
    };

    if loaded_data.merkle_tree_collection.is_none() {
        loaded_data.merkle_tree_collection = merkle_tree_collection;
    }
    if loaded_data.settlement_collection.is_none() {
        loaded_data.settlement_collection = settlement_collection;
    }

    Ok(())
}

fn load_json_merkle_tree_settlement(
    path: &PathBuf,
    loaded_data: &mut MerkleTreeSettlementLoadedData,
) -> Result<(), CliError> {
    debug!("Loading data from file: {:?}", path);
    let json_loading_result = if let Ok(merkle_tree_collection) = read_from_json_file(path) {
        let result = insert_json_parsed_data(loaded_data, Some(merkle_tree_collection), None);
        debug!("Loaded merkle tree collection from file: {:?}", path);
        result
    } else if let Ok(settlement_collection) = read_from_json_file(path) {
        let result = insert_json_parsed_data(loaded_data, None, Some(settlement_collection));
        debug!("Loaded settlement collection from file: {:?}", path);
        result
    } else {
        Err(anyhow!("Cannot load JSON data from file: {:?}", path))
    };

    json_loading_result.map_err(|e| {
        error!("Error loading JSON data from file: {:?}, {:?}", path, e);
        CliError::Critical(e)
    })
}

fn resolve_combined_optional(
    loaded_data: MerkleTreeSettlementLoadedData,
) -> anyhow::Result<CombinedMerkleTreeSettlementCollections> {
    let merkle_tree_collection = loaded_data.merkle_tree_collection;
    let settlement_collection = loaded_data.settlement_collection;
    if merkle_tree_collection.is_none() && settlement_collection.is_none() {
        Err(anyhow!("No merkle tree or settlement collection provided"))
    } else if merkle_tree_collection.is_some() && settlement_collection.is_none() {
        return Err(anyhow!(
            "No settlement collection provided for epoch {}",
            merkle_tree_collection.unwrap().epoch
        ));
    } else if merkle_tree_collection.is_none() && settlement_collection.is_some() {
        return Err(anyhow!(
            "No merkle tree collection provided for epoch {}",
            settlement_collection.unwrap().epoch
        ));
    } else {
        resolve_combined(
            merkle_tree_collection.unwrap(),
            settlement_collection.unwrap(),
        )
    }
}

fn resolve_combined(
    merkle_tree_collection: MerkleTreeCollection,
    settlement_collection: SettlementCollection,
) -> anyhow::Result<CombinedMerkleTreeSettlementCollections> {
    if merkle_tree_collection.merkle_trees.len() != settlement_collection.settlements.len()
        || merkle_tree_collection.epoch != settlement_collection.epoch
        || merkle_tree_collection.slot != settlement_collection.slot
    {
        Err(anyhow!(
            "Mismatched merkle tree and settlement collections: [array len: {} vs {}, epoch: {} vs {}, slot: {} vs {}]",
            merkle_tree_collection.merkle_trees.len(),
            settlement_collection.settlements.len(),
            merkle_tree_collection.epoch, settlement_collection.epoch, merkle_tree_collection.slot, settlement_collection.slot
        ))
    } else {
        Ok(CombinedMerkleTreeSettlementCollections {
            slot: settlement_collection.slot,
            epoch: settlement_collection.epoch,
            merkle_tree_settlements: merkle_tree_collection
                .merkle_trees
                .into_iter()
                .zip(settlement_collection.settlements)
                .map(|(merkle_tree, settlement)| {
                    assert_eq!(
                        merkle_tree.vote_account, settlement.vote_account,
                        "Mismatched vote account for loaded merkle tree and settlement data"
                    );
                    MerkleTreeMetaSettlement {
                        merkle_tree,
                        settlement,
                    }
                })
                .collect(),
        })
    }
}

/// Load on-chain data for Settlement accounts that we need to create
pub async fn load_json_with_on_chain(
    rpc_client: Arc<RpcClient>,
    json_data: &mut [CombinedMerkleTreeSettlementCollections],
    config_address: &Pubkey,
    epoch: Option<u64>,
) -> Result<HashMap<u64, Vec<SettlementRecord>>, CliError> {
    let mut settlement_records_by_epoch =
        parse_settlements_from_json(json_data, config_address, epoch)
            .map_err(CliError::Critical)?;

    // Loading accounts from on-chain, trying to not pushing many RPC calls to the network
    let (settlement_addresses, bond_addresses) = settlement_records_by_epoch
        .iter()
        .flat_map(|(_epoch, collection)| {
            collection
                .iter()
                .map(|record| (record.settlement_address, record.bond_address))
        })
        .unzip::<_, _, Vec<_>, Vec<_>>();

    let settlements = get_settlements_for_pubkeys(rpc_client.clone(), &settlement_addresses)
        .await
        .map_err(CliError::RetryAble)?
        .into_iter()
        .collect::<HashMap<Pubkey, Option<SettlementContract>>>();
    let bonds = get_bonds_for_pubkeys(rpc_client.clone(), &bond_addresses)
        .await
        .map_err(CliError::RetryAble)?
        .into_iter()
        .collect::<HashMap<Pubkey, Option<Bond>>>();

    for settlement_records_by_epoch in settlement_records_by_epoch.iter_mut() {
        for record in settlement_records_by_epoch.1.iter_mut() {
            record.settlement_account = settlements
                .get(&record.settlement_address)
                .cloned()
                .flatten();
            record.bond_account = bonds.get(&record.bond_address).cloned().flatten();

            // sanity check
            if let Some(settlement_account) = &record.settlement_account {
                assert_eq!(
                    settlement_account.bond, record.bond_address,
                    "Mismatched bond address"
                );
            }
        }
    }

    Ok(settlement_records_by_epoch)
}

fn pair_elements<T: Clone>(elements: &[T]) -> anyhow::Result<Vec<(T, T)>> {
    if elements.len() % 2 != 0 {
        return Err(anyhow!("The number of elements is not even"));
    }
    let pairs = elements
        .chunks(2)
        .map(|chunk| {
            // It is safe to index chunks[0] and chunks[1] as we ensured length is even
            let first = chunk[0].clone();
            let second = chunk[1].clone();
            (first, second)
        })
        .collect::<Vec<(T, T)>>();

    Ok(pairs)
}

fn check_is_file(path: &PathBuf) -> bool {
    if path.is_file() {
        debug!("Processing file: {:?}", path);
        true
    } else {
        debug!("Skipping path: {:?} as not a file", path);
        false
    }
}
