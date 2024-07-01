use crate::cli_result::CliError;
use crate::settlement_data::{parse_settlements_from_json, SettlementRecord};
use anchor_client::anchor_lang::prelude::Pubkey;
use anyhow::anyhow;
use log::{debug, error, info};
use merkle_tree::serde_serialize::pubkey_string_conversion;
use serde::{Deserialize, Serialize};
use settlement_engine::merkle_tree_collection::{MerkleTreeCollection, MerkleTreeMeta};
use settlement_engine::settlement_claims::{Settlement, SettlementCollection};
use settlement_engine::utils::read_from_json_file;
use solana_client::nonblocking::rpc_client::RpcClient;
use std::collections::{HashMap, HashSet};
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

/// Load JSON data from files and returns a map of EPOCH -> DATA
pub fn load_json(
    settlement_json_files: &[PathBuf],
) -> anyhow::Result<Vec<CombinedMerkleTreeSettlementCollections>> {
    let mut json_data: HashMap<u64, MerkleTreeLoadedData> = HashMap::new();
    for path in settlement_json_files.iter().filter(|path| {
        if path.is_file() {
            debug!("Processing file: {:?}", path);
            true
        } else {
            debug!("Skipping file: {:?}, as it's not a file", path);
            false
        }
    }) {
        load_json_data_to_merkle_tree(path, &mut json_data)?;
    }
    let mut claiming_data = json_data
        .into_values()
        .map(|data| {
            resolve_combined_optional(data.merkle_tree_collection, data.settlement_collection)
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    claiming_data.sort_by_key(|c| c.epoch);

    info!(
        "Loaded json data from {:?} for epochs: {:?}",
        settlement_json_files
            .iter()
            .map(|p| p.to_str())
            .collect::<Vec<_>>(),
        // deduplicate and sort the epochs
        claiming_data
            .iter()
            .map(|v| v.epoch)
            .collect::<HashSet<_>>()
            .iter()
            .collect::<Vec<_>>()
            .sort()
    );
    Ok(claiming_data)
}

struct MerkleTreeLoadedData {
    merkle_tree_collection: Option<MerkleTreeCollection>,
    settlement_collection: Option<SettlementCollection>,
}

fn insert_merkle_tree_parsed_data(
    loaded_data: &mut HashMap<u64, MerkleTreeLoadedData>,
    merkle_tree_collection: Option<MerkleTreeCollection>,
    settlement_collection: Option<SettlementCollection>,
) -> anyhow::Result<()> {
    // Get the epoch and handle mismatches
    let epoch = match (&merkle_tree_collection, &settlement_collection) {
        (Some(mc), Some(sc)) if mc.epoch != sc.epoch => {
            return Err(CliError::processing(format!(
                "Epoch mismatch between merkle tree collection and settlement collection: {} != {}",
                mc.epoch, sc.epoch
            )));
        }
        (Some(mc), _) => mc.epoch,
        (_, Some(sc)) => sc.epoch,
        _ => {
            return Err(CliError::processing(
                "No epoch found in either merkle tree collection or settlement collection",
            ));
        }
    };

    let record = loaded_data
        .entry(epoch)
        .or_insert_with(|| MerkleTreeLoadedData {
            merkle_tree_collection: None,
            settlement_collection: None,
        });
    if record.merkle_tree_collection.is_none() {
        record.merkle_tree_collection = merkle_tree_collection;
    }
    if record.settlement_collection.is_none() {
        record.settlement_collection = settlement_collection;
    }

    Ok(())
}

fn load_json_data_to_merkle_tree(
    path: &PathBuf,
    loaded_data: &mut HashMap<u64, MerkleTreeLoadedData>,
) -> Result<(), CliError> {
    debug!("Loading data from file: {:?}", path);
    let json_loading_result = if let Ok(merkle_tree_collection) = read_from_json_file(path) {
        insert_merkle_tree_parsed_data(loaded_data, Some(merkle_tree_collection), None)
    } else if let Ok(settlement_collection) = read_from_json_file(path) {
        insert_merkle_tree_parsed_data(loaded_data, None, Some(settlement_collection))
    } else {
        Err(anyhow!("Cannot load JSON data from file: {:?}", path))
    };

    json_loading_result.map_err(|e| {
        error!("Error loading JSON data from file: {:?}, {:?}", path, e);
        CliError::Processing(e)
    })
}

fn resolve_combined_optional(
    merkle_tree_collection: Option<MerkleTreeCollection>,
    settlement_collection: Option<SettlementCollection>,
) -> anyhow::Result<CombinedMerkleTreeSettlementCollections> {
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
pub fn resolve_combined(
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
                .map(|(merkle_tree, settlement)| MerkleTreeMetaSettlement {
                    merkle_tree,
                    settlement,
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
            .map_err(CliError::Processing)?;

    // Loading accounts from on-chain, trying to not pushing many RPC calls to the network
    let (settlement_addresses, bond_addresses) = settlement_records_by_epoch
        .iter()
        .flat_map(|(_epoch, colection)| {
            colection
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

    for settlement_recods_by_epoch in settlement_records_by_epoch.iter_mut() {
        for record in settlement_recods_by_epoch.1.iter_mut() {
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
