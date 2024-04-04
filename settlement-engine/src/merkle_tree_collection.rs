use crate::settlement_claims::SettlementCollection;
use log::info;
use solana_sdk::pubkey::Pubkey;

use {
    crate::settlement_claims::{Settlement, SettlementClaim},
    merkle_tree::{psr_claim::TreeNode, serde_serialize::pubkey_string_conversion, MerkleTree},
    serde::{Deserialize, Serialize},
    solana_sdk::hash::Hash,
};

#[derive(Default, Clone, Deserialize, Serialize)]
pub struct MerkleTreeMeta {
    pub merkle_root: Option<Hash>,
    pub max_total_claim_sum: u64,
    pub max_total_claims: usize,
    #[serde(with = "pubkey_string_conversion")]
    pub vote_account: Pubkey,
    pub tree_nodes: Vec<TreeNode>,
}

#[derive(Default, Clone, Deserialize, Serialize)]
pub struct MerkleTreeCollection {
    pub epoch: u64,
    pub slot: u64,
    pub merkle_trees: Vec<MerkleTreeMeta>,
}

pub fn generate_merkle_tree_meta(settlement: &Settlement) -> anyhow::Result<MerkleTreeMeta> {
    let vote_account = settlement.vote_account;
    info!("Generation merkle tree for settlements of validator: {vote_account}...");
    let mut tree_nodes: Vec<_> = settlement
        .claims
        .iter()
        .cloned()
        .map(
            |SettlementClaim {
                 withdraw_authority,
                 stake_authority,
                 claim_amount,
                 ..
             }| TreeNode {
                stake_authority,
                withdraw_authority,
                claim: claim_amount,
                ..Default::default()
            },
        )
        .collect();

    let max_total_claim_sum: u64 = tree_nodes.iter().map(|node| node.claim).sum();
    let max_total_claims = tree_nodes.len();

    assert_eq!(max_total_claim_sum, settlement.claims_amount);
    assert_eq!(max_total_claims, settlement.claims_count);

    let hashed_nodes: Vec<[u8; 32]> = tree_nodes.iter().map(|n| n.hash().to_bytes()).collect();
    let merkle_tree = MerkleTree::new(&hashed_nodes[..], true);

    for (i, tree_node) in tree_nodes.iter_mut().enumerate() {
        tree_node.proof = Some(get_proof(&merkle_tree, i));
    }

    Ok(MerkleTreeMeta {
        merkle_root: merkle_tree.get_root().cloned(),
        max_total_claim_sum,
        max_total_claims,
        tree_nodes,
        vote_account,
    })
}

pub fn generate_merkle_tree_collection(
    settlement_collection: SettlementCollection,
) -> anyhow::Result<MerkleTreeCollection> {
    let mut merkle_trees = vec![];

    for settlement in settlement_collection.settlements.iter() {
        merkle_trees.push(generate_merkle_tree_meta(settlement)?);
    }

    Ok(MerkleTreeCollection {
        epoch: settlement_collection.epoch,
        slot: settlement_collection.slot,
        merkle_trees,
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

#[cfg(test)]
mod tests {
    use super::*;
    use solana_sdk::bs58;
    use solana_sdk::hash::hashv;
    use solana_sdk::pubkey::Pubkey;
    use std::str::FromStr;

    /// This is a constant pubkey test to verify against the TS tree node implementation
    /// the TS implementation uses the same static pubkeys and the tests should pass here and there
    #[test]
    pub fn ts_cross_check_hash_generate() {
        let tree_node_hash = TreeNode {
            stake_authority: Pubkey::from_str("EjeWgRiaawLSCUM7uojZgSnwipEiypS986yorgvfAzYW")
                .unwrap(),
            withdraw_authority: Pubkey::from_str("BT6Y2kX5RLhQ6DDzbjbiHNDyyWJgn9jp7g5rCFn8stqy")
                .unwrap(),
            claim: 444,
            proof: None,
        }
        .hash();
        let leaf_hash = hashv(&[&[0], tree_node_hash.as_ref()]).to_bytes();
        assert_eq!(
            tree_node_hash.to_string(),
            "A2grPmDuPXWQK2Qch7b2pj97SunPw3xjpxDV8efAtAZD"
        );
        assert_eq!(
            bs58::encode(leaf_hash).into_string(),
            "CRZSudMd4t7FWQnnpd8scbtrZepB7mMZa9HgBv2pkZRN"
        );
    }

    // TS cross-check constant test
    #[test]
    pub fn ts_cross_check_merkle_proof() {
        let mut items_vote_account1: Vec<TreeNode> = vec![
            TreeNode {
                stake_authority: Pubkey::from_str("82ewSU2zNH87PajZHf7betFbZAaGR8bwDp8azSHNCAnA")
                    .unwrap(),
                withdraw_authority: Pubkey::from_str(
                    "3vGstFWWyQbDknu9WKr9vbTn2Kw5qgorP7UkRXVrfe9t",
                )
                .unwrap(),
                claim: 1234,
                proof: None,
            },
            TreeNode {
                stake_authority: Pubkey::from_str("82ewSU2zNH87PajZHf7betFbZAaGR8bwDp8azSHNCAnA")
                    .unwrap(),
                withdraw_authority: Pubkey::from_str(
                    "DBnWKq1Ln9y8HtGwYxFMqMWLY1Ld9xpB28ayKfHejiTs",
                )
                .unwrap(),
                claim: 99999,
                proof: None,
            },
            TreeNode {
                stake_authority: Pubkey::from_str("yrWTX1AuJRqziVpdhg3eAWYhDcY6z1kmEaG4sn1uDDj")
                    .unwrap(),
                withdraw_authority: Pubkey::from_str(
                    "CgoqXy3e1hsnuNw6bJ8iuzqZwr93CA4jsRa1AnsseJ53",
                )
                .unwrap(),
                claim: 212121,
                proof: None,
            },
        ];
        let mut items_vote_account2: Vec<TreeNode> = vec![
            TreeNode {
                stake_authority: Pubkey::from_str("yrWTX1AuJRqziVpdhg3eAWYhDcY6z1kmEaG4sn1uDDj")
                    .unwrap(),
                withdraw_authority: Pubkey::from_str(
                    "3vGstFWWyQbDknu9WKr9vbTn2Kw5qgorP7UkRXVrfe9t",
                )
                .unwrap(),
                claim: 69,
                proof: None,
            },
            TreeNode {
                stake_authority: Pubkey::from_str("121WqnefAgXvLZdW42LsGUbkFjv7LVUqvcpkskxyVgeu")
                    .unwrap(),
                withdraw_authority: Pubkey::from_str(
                    "DBnWKq1Ln9y8HtGwYxFMqMWLY1Ld9xpB28ayKfHejiTs",
                )
                .unwrap(),
                claim: 111111,
                proof: None,
            },
        ];
        let mut items_operator: Vec<TreeNode> = vec![
            TreeNode {
                stake_authority: Pubkey::from_str("yrWTX1AuJRqziVpdhg3eAWYhDcY6z1kmEaG4sn1uDDj")
                    .unwrap(),
                withdraw_authority: Pubkey::from_str(
                    "DBnWKq1Ln9y8HtGwYxFMqMWLY1Ld9xpB28ayKfHejiTs",
                )
                .unwrap(),
                claim: 556677,
                proof: None,
            },
            TreeNode {
                stake_authority: Pubkey::from_str("121WqnefAgXvLZdW42LsGUbkFjv7LVUqvcpkskxyVgeu")
                    .unwrap(),
                withdraw_authority: Pubkey::from_str(
                    "CgoqXy3e1hsnuNw6bJ8iuzqZwr93CA4jsRa1AnsseJ53",
                )
                .unwrap(),
                claim: 996677,
                proof: None,
            },
        ];

        let item_vote_account1_hashes = items_vote_account1
            .clone()
            .iter()
            .map(|n| n.hash())
            .collect::<Vec<_>>();
        let merkle_tree_vote_account1 = MerkleTree::new(&item_vote_account1_hashes[..], true);
        let merkle_tree_vote_account1_root = merkle_tree_vote_account1.get_root().unwrap();
        println!(
            "merkle tree root vote account 1: {}",
            merkle_tree_vote_account1_root
        );
        assert_eq!(
            merkle_tree_vote_account1_root.to_string(),
            "EnBJg4qV4GjH3Sgigsi8wkWz966QYgSQkgPMCmWto51f"
        );
        for (i, tree_node) in items_vote_account1.iter_mut().enumerate() {
            tree_node.proof = Some(get_proof(&merkle_tree_vote_account1, i));
            println!(
                "vote account1: proof: {:?}, hash tree node: {}",
                tree_node.proof,
                tree_node.hash()
            )
        }
        assert_eq!(
            item_vote_account1_hashes.get(1).unwrap().to_string(),
            "AQT4KsCwXci528hys9WgWcURigR4TiNKDsCV9iEmVZ1P"
        );

        let item_vote_account2_hashes = items_vote_account2
            .clone()
            .iter()
            .map(|n| n.hash())
            .collect::<Vec<_>>();
        let merkle_tree_vote_account2 = MerkleTree::new(&item_vote_account2_hashes[..], true);
        let merkle_tree_vote_account2_root = merkle_tree_vote_account2.get_root().unwrap();
        println!(
            "merkle tree root vote account 2: {}",
            merkle_tree_vote_account2_root
        );
        assert_eq!(
            merkle_tree_vote_account2_root.to_string(),
            "Asi9uVpB3Tx29L17X3Z46jrPizKywTRttqsvnLTzgh27"
        );
        for (i, tree_node) in items_vote_account2.iter_mut().enumerate() {
            tree_node.proof = Some(get_proof(&merkle_tree_vote_account2, i));
            println!(
                "vote account2: proof: {:?}, hash tree node: {}",
                tree_node.proof,
                tree_node.hash()
            )
        }
        assert_eq!(
            item_vote_account2_hashes.get(1).unwrap().to_string(),
            "4WmpRvgW6HdHW4bPVEqPVJXyF2mVG9wpH5mGpgzjmJGY"
        );

        let item_operator_hashes = items_operator
            .clone()
            .iter()
            .map(|n| n.hash())
            .collect::<Vec<_>>();
        let merkle_tree_operator = MerkleTree::new(&item_operator_hashes[..], true);
        let merkle_tree_operator_root = merkle_tree_operator.get_root().unwrap();
        println!("merkle tree root operator: {}", merkle_tree_operator_root);
        assert_eq!(
            merkle_tree_operator_root.to_string(),
            "D8rFThGJXYVFcKdqovz3VMA1nALNugHzvGYhSn8dLwip"
        );
        for (i, tree_node) in items_operator.iter_mut().enumerate() {
            tree_node.proof = Some(get_proof(&merkle_tree_operator, i));
            println!(
                "operator: proof: {:?}, hash tree node: {}",
                tree_node.proof,
                tree_node.hash()
            )
        }
    }
}
