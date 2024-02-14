use solana_sdk::pubkey::Pubkey;
use {
    crate::insurance_claims::{InsuranceClaim, InsuranceClaimCollection},
    merkle_tree::{psr_claim::TreeNode, serde_serialize::pubkey_string_conversion, MerkleTree},
    serde::{Deserialize, Serialize},
    solana_sdk::hash::Hash,
    std::collections::HashMap,
};

#[derive(Default, Clone, Deserialize, Serialize)]
pub struct ClaimLimit {
    #[serde(with = "pubkey_string_conversion")]
    pub vote_account: Pubkey,
    pub max_total_claim_sum: u64,
    pub max_total_claims: usize,
}

#[derive(Default, Clone, Deserialize, Serialize)]
pub struct MerkleTreeCollection {
    pub epoch: u64,
    pub slot: u64,
    pub merkle_root: Option<Hash>,
    pub max_total_claim_sum: u64,
    pub max_total_claims: usize,
    pub claim_limits: Vec<ClaimLimit>,
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

    let claim_limits = insurance_claims_collection
        .claims
        .iter()
        .fold(
            HashMap::default(),
            |mut claim_limits: HashMap<Pubkey, ClaimLimit>,
             InsuranceClaim {
                 vote_account,
                 claim,
                 ..
             }| {
                let claim_limit = claim_limits.entry(*vote_account).or_insert(ClaimLimit {
                    vote_account: *vote_account,
                    max_total_claim_sum: 0,
                    max_total_claims: 0,
                });
                claim_limit.max_total_claims += 1;
                claim_limit.max_total_claim_sum += claim;

                claim_limits
            },
        )
        .values()
        .cloned()
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
        claim_limits,
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
            vote_account: Pubkey::from_str("DYSosfmS9gp1hTY4jAdKJFWK3XHsemecgVPwjqgwM2Pb").unwrap(),
            claim: 444,
            proof: None,
        }
        .hash();
        let leaf_hash = hashv(&[&[0], tree_node_hash.as_ref()]).to_bytes();
        assert_eq!(
            tree_node_hash.to_string(),
            "4zDyYyE5oGrun3Uvfav5hVuRZbAf3a7tXkrgQFtj8XUm"
        );
        assert_eq!(
            bs58::encode(leaf_hash).into_string(),
            "GjUZTX9QYsa84HuHHXQNJFghuh7aYuEhtoFEoNquTSuy"
        );
    }

    // TS cross-check constant test
    #[test]
    pub fn ts_cross_check_merkle_proof() {
        let mut items: Vec<TreeNode> = vec![
            TreeNode {
                stake_authority: Pubkey::from_str("82ewSU2zNH87PajZHf7betFbZAaGR8bwDp8azSHNCAnA")
                    .unwrap(),
                withdraw_authority: Pubkey::from_str(
                    "3vGstFWWyQbDknu9WKr9vbTn2Kw5qgorP7UkRXVrfe9t",
                )
                .unwrap(),
                vote_account: Pubkey::from_str("FHUuZcuLB3ZLWZhKoY7metTEJ2Y2Xton99TTuDmzFmgW")
                    .unwrap(),
                claim: 1234,
                proof: None,
            },
            TreeNode {
                stake_authority: Pubkey::from_str("612S5jWDKhCxdzugJ6JED5whc1dCkZBPrer3mx3D2V5J")
                    .unwrap(),
                withdraw_authority: Pubkey::from_str(
                    "DBnWKq1Ln9y8HtGwYxFMqMWLY1Ld9xpB28ayKfHejiTs",
                )
                .unwrap(),
                vote_account: Pubkey::from_str("FHUuZcuLB3ZLWZhKoY7metTEJ2Y2Xton99TTuDmzFmgW")
                    .unwrap(),
                claim: 99999,
                proof: None,
            },
            TreeNode {
                stake_authority: Pubkey::from_str("612S5jWDKhCxdzugJ6JED5whc1dCkZBPrer3mx3D2V5J")
                    .unwrap(),
                withdraw_authority: Pubkey::from_str(
                    "CgoqXy3e1hsnuNw6bJ8iuzqZwr93CA4jsRa1AnsseJ53",
                )
                .unwrap(),
                vote_account: Pubkey::from_str("FHUuZcuLB3ZLWZhKoY7metTEJ2Y2Xton99TTuDmzFmgW")
                    .unwrap(),
                claim: 212121,
                proof: None,
            },
            TreeNode {
                stake_authority: Pubkey::from_str("612S5jWDKhCxdzugJ6JED5whc1dCkZBPrer3mx3D2V5J")
                    .unwrap(),
                withdraw_authority: Pubkey::from_str(
                    "3vGstFWWyQbDknu9WKr9vbTn2Kw5qgorP7UkRXVrfe9t",
                )
                .unwrap(),
                vote_account: Pubkey::from_str("9D6EuvndvhgDBLRzpxNjHdvLWicJE1WvZrdTbapjhKR6")
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
                vote_account: Pubkey::from_str("9D6EuvndvhgDBLRzpxNjHdvLWicJE1WvZrdTbapjhKR6")
                    .unwrap(),
                claim: 111111,
                proof: None,
            },
        ];
        let item_hashes = items.clone().iter().map(|n| n.hash()).collect::<Vec<_>>();
        let merkle_tree = MerkleTree::new(&item_hashes[..], true);
        let merkle_tree_root = merkle_tree.get_root().unwrap();
        println!("merkle tree root: {}", merkle_tree_root);
        for (i, tree_node) in items.iter_mut().enumerate() {
            tree_node.proof = Some(get_proof(&merkle_tree, i));
            println!(
                "proof: {:?}, hash tree node: {}",
                tree_node.proof,
                tree_node.hash()
            )
        }
        assert_eq!(
            merkle_tree_root.to_string(),
            "7iF4883Y16rWHqYrtdmn6ykvV7NvGsbibnmZwBanojZD"
        );
        let check_proof = [
            [
                43, 115, 25, 67, 8, 94, 86, 102, 222, 131, 96, 254, 188, 172, 164, 179, 156, 92,
                79, 248, 195, 120, 183, 106, 96, 38, 120, 23, 59, 195, 169, 208,
            ],
            [
                159, 219, 61, 246, 151, 49, 200, 46, 195, 10, 112, 214, 44, 95, 201, 51, 28, 38,
                135, 106, 58, 162, 239, 247, 191, 121, 138, 103, 191, 34, 100, 153,
            ],
            [
                96, 247, 12, 68, 67, 41, 253, 26, 149, 121, 158, 236, 188, 56, 19, 184, 242, 63,
                242, 61, 147, 50, 119, 26, 21, 76, 36, 242, 151, 143, 142, 182,
            ],
        ];
        assert_eq!(items.get(3).unwrap().proof, Some(check_proof.to_vec()));
        assert_eq!(
            item_hashes.get(3).unwrap().to_string(),
            "2g6GGBps8fTTq9DvJHwBxNC57k5REDFbjebWYyw9qDYQ"
        );
    }
}
