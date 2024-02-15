use {
    crate::insurance_claims::{InsuranceClaim, InsuranceClaimCollection},
    merkle_tree::insurance_engine::TreeNode,
    merkle_tree::MerkleTree,
    serde::{Deserialize, Serialize},
    solana_sdk::hash::Hash,
    std::collections::HashMap,
};

#[derive(Default, Clone, Deserialize, Serialize)]
pub struct ClaimLimit {
    pub vote_account: String,
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
            |mut claim_limits: HashMap<String, ClaimLimit>,
             InsuranceClaim {
                 vote_account,
                 claim,
                 ..
             }| {
                let claim_limit = claim_limits
                    .entry(vote_account.clone())
                    .or_insert(ClaimLimit {
                        vote_account: vote_account.clone(),
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
        let hash_pub = TreeNode {
            stake_authority: Pubkey::from_str("EjeWgRiaawLSCUM7uojZgSnwipEiypS986yorgvfAzYW")
                .unwrap()
                .to_string(),
            withdraw_authority: Pubkey::from_str("BT6Y2kX5RLhQ6DDzbjbiHNDyyWJgn9jp7g5rCFn8stqy")
                .unwrap()
                .to_string(),
            vote_account: Pubkey::from_str("DYSosfmS9gp1hTY4jAdKJFWK3XHsemecgVPwjqgwM2Pb")
                .unwrap()
                .to_string(),
            claim: 444,
            proof: None,
        }
        .hash();
        let tree_node = hashv(&[&[0], hash_pub.as_ref()]).to_bytes();
        assert_eq!(
            hash_pub.to_string(),
            "3LrYLzt4P6LJCyLsbYPAes4d5U8aohjbmW1dJvbrkdse"
        );
        assert_eq!(
            bs58::encode(tree_node).into_string(),
            "37uc7x9LVzJqsPB9un28SJEPbSop8NGHXHQjZCe6GKAX"
        );
    }

    // TS cross-check constant test
    #[test]
    pub fn ts_cross_check_merkle_proof() {
        let mut items: Vec<TreeNode> = vec![
            TreeNode {
                stake_authority: "612S5jWDKhCxdzugJ6JED5whc1dCkZBPrer3mx3D2V5J".to_string(),
                withdraw_authority: "3vGstFWWyQbDknu9WKr9vbTn2Kw5qgorP7UkRXVrfe9t".to_string(),
                vote_account: "FHUuZcuLB3ZLWZhKoY7metTEJ2Y2Xton99TTuDmzFmgW".to_string(),
                claim: 1234,
                proof: None,
            },
            TreeNode {
                stake_authority: "612S5jWDKhCxdzugJ6JED5whc1dCkZBPrer3mx3D2V5J".to_string(),
                withdraw_authority: "DBnWKq1Ln9y8HtGwYxFMqMWLY1Ld9xpB28ayKfHejiTs".to_string(),
                vote_account: "FHUuZcuLB3ZLWZhKoY7metTEJ2Y2Xton99TTuDmzFmgW".to_string(),
                claim: 99999,
                proof: None,
            },
            TreeNode {
                stake_authority: "612S5jWDKhCxdzugJ6JED5whc1dCkZBPrer3mx3D2V5J".to_string(),
                withdraw_authority: "CgoqXy3e1hsnuNw6bJ8iuzqZwr93CA4jsRa1AnsseJ53".to_string(),
                vote_account: "FHUuZcuLB3ZLWZhKoY7metTEJ2Y2Xton99TTuDmzFmgW".to_string(),
                claim: 212121,
                proof: None,
            },
            TreeNode {
                stake_authority: "612S5jWDKhCxdzugJ6JED5whc1dCkZBPrer3mx3D2V5J".to_string(),
                withdraw_authority: "3vGstFWWyQbDknu9WKr9vbTn2Kw5qgorP7UkRXVrfe9t".to_string(),
                vote_account: "9D6EuvndvhgDBLRzpxNjHdvLWicJE1WvZrdTbapjhKR6".to_string(),
                claim: 69,
                proof: None,
            },
            TreeNode {
                stake_authority: "612S5jWDKhCxdzugJ6JED5whc1dCkZBPrer3mx3D2V5J".to_string(),
                withdraw_authority: "DBnWKq1Ln9y8HtGwYxFMqMWLY1Ld9xpB28ayKfHejiTs".to_string(),
                vote_account: "9D6EuvndvhgDBLRzpxNjHdvLWicJE1WvZrdTbapjhKR6".to_string(),
                claim: 111111,
                proof: None,
            },
        ];
        let item_hashes = items.clone().iter().map(|n| n.hash()).collect::<Vec<_>>();
        let merkle_tree = MerkleTree::new(&item_hashes[..], true);
        let merkle_tree_root = merkle_tree.get_root().unwrap();
        // println!("merkle tree root: {}", merkle_tree_root);
        for (i, tree_node) in items.iter_mut().enumerate() {
            tree_node.proof = Some(get_proof(&merkle_tree, i));
            // println!(
            //     "proof: {:?}, hash tree node: {}",
            //     tree_node.proof,
            //     tree_node.hash()
            // )
        }
        assert_eq!(
            merkle_tree_root.to_string(),
            "CJWSpJD2yeL1JPUH9pyfAefFetdiSuvPNCqq5LfQ71je"
        );
        let check_proof = [
            [
                217, 141, 69, 36, 65, 205, 32, 76, 165, 35, 197, 94, 188, 141, 93, 158, 129, 239,
                253, 174, 42, 156, 151, 29, 197, 253, 160, 116, 10, 112, 12, 10,
            ],
            [
                190, 99, 233, 8, 249, 68, 135, 70, 128, 15, 2, 169, 47, 194, 102, 12, 200, 64, 213,
                103, 134, 64, 112, 215, 201, 36, 212, 236, 32, 93, 76, 106,
            ],
            [
                147, 52, 104, 182, 174, 190, 248, 228, 27, 240, 240, 245, 6, 218, 13, 196, 53, 63,
                242, 117, 208, 239, 15, 106, 255, 30, 248, 47, 107, 170, 233, 94,
            ],
        ];
        assert_eq!(items.get(3).unwrap().proof, Some(check_proof.to_vec()));
        assert_eq!(
            item_hashes.get(3).unwrap().to_string(),
            "C94ftStYh3afdysMEnf4KGMvyQZVcMY6P16UkEJGkYbU"
        );
    }
}
