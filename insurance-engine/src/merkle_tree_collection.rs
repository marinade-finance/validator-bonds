use crate::insurance_claims::InsuranceClaim;

use {
    crate::insurance_claims::InsuranceClaimCollection,
    merkle_tree::MerkleTree,
    serde::{Deserialize, Serialize},
    solana_sdk::hash::{Hash, Hasher},
};

#[derive(Default, Clone, Eq, Debug, Hash, PartialEq, Deserialize, Serialize)]
pub struct TreeNode {
    pub stake_authority: String,
    pub withdraw_authority: String,
    pub vote_account: String,
    pub claim: u64,
    pub proof: Option<Vec<[u8; 32]>>,
}

impl TreeNode {
    fn hash(&self) -> Hash {
        let mut hasher = Hasher::default();
        hasher.hash(self.stake_authority.as_ref());
        hasher.hash(self.withdraw_authority.as_ref());
        hasher.hash(self.vote_account.as_ref());
        hasher.hash(self.claim.to_le_bytes().as_ref());
        hasher.result()
    }
}

#[derive(Default, Clone, Deserialize, Serialize)]
pub struct MerkleTreeCollection {
    pub epoch: u64,
    pub slot: u64,
    pub merkle_root: Option<Hash>,
    pub max_total_claim_sum: u64,
    pub max_total_claims: usize,
    pub tree_nodes: Vec<TreeNode>,
}

pub fn generate_merkle_tree_collection(
    insurance_claims_collection: InsuranceClaimCollection,
) -> anyhow::Result<MerkleTreeCollection> {
    let mut tree_nodes: Vec<_> = insurance_claims_collection
        .claims
        .iter()
        .cloned()
        .map(
            |InsuranceClaim {
                 withdraw_authority,
                 stake_authority,
                 vote_account,
                 claim,
                 ..
             }| TreeNode {
                stake_authority,
                withdraw_authority,
                vote_account,
                claim,
                ..Default::default()
            },
        )
        .collect();

    let max_total_claim_sum: u64 = tree_nodes.iter().map(|node| node.claim).sum();

    let hashed_nodes: Vec<[u8; 32]> = tree_nodes.iter().map(|n| n.hash().to_bytes()).collect();
    let merkle_tree = MerkleTree::new(&hashed_nodes[..], true);

    for (i, tree_node) in tree_nodes.iter_mut().enumerate() {
        tree_node.proof = Some(get_proof(&merkle_tree, i));
    }

    Ok(MerkleTreeCollection {
        epoch: insurance_claims_collection.epoch,
        slot: insurance_claims_collection.slot,
        merkle_root: merkle_tree.get_root().cloned(),
        max_total_claim_sum,
        max_total_claims: tree_nodes.len(),
        tree_nodes,
    })
}

fn get_proof(merkle_tree: &MerkleTree, i: usize) -> Vec<[u8; 32]> {
    let mut proof = Vec::new();
    let path = merkle_tree.find_path(i).expect("path to index");
    for branch in path.get_proof_entries() {
        if let Some(hash) = branch.get_left_sibling() {
            proof.push(hash.to_bytes());
        } else if let Some(hash) = branch.get_right_sibling() {
            proof.push(hash.to_bytes());
        } else {
            panic!("expected some hash at each level of the tree");
        }
    }
    proof
}
