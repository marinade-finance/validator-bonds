use anyhow::anyhow;
use settlement_engine::merkle_tree_collection::{MerkleTreeCollection, MerkleTreeMeta};
use settlement_engine::settlement_claims::{Settlement, SettlementCollection};

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

pub fn resolve_combined_optional(
    merkle_tree_collection: Option<MerkleTreeCollection>,
    settlement_collection: Option<SettlementCollection>,
) -> anyhow::Result<CombinedMerkleTreeSettlementCollections> {
    if merkle_tree_collection.is_none() && settlement_collection.is_none() {
        Err(anyhow!("No merkle tree or settlement collection provided"))
    } else if merkle_tree_collection.is_some() && settlement_collection.is_none() {
        return Err(anyhow!("No settlement collection provided"));
    } else if merkle_tree_collection.is_none() && settlement_collection.is_some() {
        return Err(anyhow!("No merkle tree collection provided"));
    } else {
        resolve_combined(
            merkle_tree_collection.unwrap(),
            settlement_collection.unwrap(),
        )
    }
}
