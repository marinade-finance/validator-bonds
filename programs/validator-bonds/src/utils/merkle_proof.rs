use anchor_lang::solana_program::hash::hashv;
use merkle_tree::{hash_intermediate, INTERMEDIATE_PREFIX};

/// copy&paste from https://github.com/jito-foundation/jito-programs/blob/master/mev-programs/programs/tip-distribution/src/merkle_proof.rs
/// This function deals with verification of Merkle trees (hash trees).
/// Direct port of https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v3.4.0/contracts/cryptography/MerkleProof.sol
/// Returns true if a `leaf` can be proved to be a part of a Merkle tree
/// defined by `root`. For this, a `proof` must be provided, containing
/// sibling hashes on the branch from the leaf to the root of the tree. Each
/// pair of leaves and each pair of pre-images are assumed to be sorted.
pub fn verify(proof: Vec<[u8; 32]>, root: [u8; 32], leaf: [u8; 32]) -> bool {
    let mut computed_hash = leaf;
    for proof_element in proof.into_iter() {
        if computed_hash <= proof_element {
            // Hash(current computed hash + current element of the proof)
            computed_hash = hash_intermediate!(computed_hash, proof_element).to_bytes();
        } else {
            // Hash(current element of the proof + current computed hash)
            computed_hash = hash_intermediate!(proof_element, computed_hash).to_bytes();
        }
    }
    // Check if the computed hash (root) is equal to the provided root
    computed_hash == root
}

#[cfg(test)]
mod tests {
    use crate::utils::verify;
    use anchor_lang::solana_program::{hash::hashv, pubkey::Pubkey};
    use merkle_tree::psr_claim::TreeNode;
    use merkle_tree::{hash_leaf, LEAF_PREFIX};
    use std::str::FromStr;

    // data from google cloud bucket marinade-validator-bonds-mainnet / 581 / claims_merkle_all.json
    #[test]
    pub fn claim_merkle_check() {
        let merkle_root: [u8; 32] = [
            30, 232, 221, 91, 155, 42, 128, 93, 172, 90, 164, 115, 240, 105, 158, 42, 14, 192, 77,
            228, 140, 157, 61, 192, 228, 5, 89, 58, 158, 109, 152, 225,
        ];
        let proof: Vec<[u8; 32]> = vec![
            [
                236, 35, 232, 173, 99, 163, 152, 92, 242, 215, 208, 34, 189, 60, 32, 250, 95, 73,
                64, 206, 170, 112, 78, 166, 220, 69, 175, 230, 58, 97, 210, 2,
            ],
            [
                84, 194, 46, 188, 118, 239, 234, 204, 88, 88, 128, 67, 43, 237, 129, 205, 222, 219,
                67, 205, 220, 70, 34, 108, 29, 8, 252, 96, 174, 179, 147, 118,
            ],
            [
                184, 237, 180, 223, 61, 52, 227, 73, 11, 241, 237, 165, 91, 102, 70, 246, 175, 207,
                164, 184, 32, 162, 115, 84, 24, 18, 88, 57, 1, 72, 6, 133,
            ],
            [
                20, 67, 19, 138, 116, 139, 179, 240, 178, 62, 33, 139, 187, 101, 246, 3, 75, 95,
                148, 88, 112, 75, 115, 77, 197, 88, 184, 19, 54, 45, 243, 58,
            ],
            [
                170, 246, 214, 42, 253, 210, 203, 88, 163, 235, 48, 106, 229, 47, 129, 87, 191,
                193, 249, 17, 189, 245, 9, 157, 253, 165, 69, 47, 182, 207, 113, 245,
            ],
            [
                63, 209, 138, 197, 53, 135, 145, 195, 150, 254, 176, 170, 57, 14, 79, 241, 5, 187,
                203, 69, 166, 239, 205, 167, 230, 1, 122, 134, 83, 85, 131, 57,
            ],
            [
                206, 157, 78, 218, 215, 92, 118, 39, 244, 145, 97, 8, 52, 149, 246, 238, 69, 132,
                112, 140, 194, 152, 144, 157, 228, 64, 111, 32, 235, 22, 20, 54,
            ],
            [
                245, 140, 190, 227, 229, 85, 117, 5, 217, 210, 109, 22, 91, 155, 138, 57, 138, 14,
                247, 158, 47, 195, 18, 4, 247, 17, 27, 57, 145, 0, 105, 17,
            ],
            [
                156, 33, 234, 214, 75, 238, 76, 87, 111, 237, 123, 131, 121, 192, 190, 1, 53, 159,
                211, 2, 194, 151, 31, 17, 189, 91, 141, 182, 209, 180, 57, 41,
            ],
            [
                144, 29, 16, 102, 70, 130, 94, 70, 70, 131, 23, 70, 192, 213, 155, 181, 12, 230, 7,
                240, 148, 254, 11, 229, 243, 68, 16, 159, 47, 248, 31, 130,
            ],
        ];
        let staker_authority =
            Pubkey::from_str("86CYtc913SJFS2tuA6CpXEej6ekz8mMdBhtGwvKUUWRB").unwrap();
        let withdrawer_authority =
            Pubkey::from_str("EhYXq3ANp5nAerUpbSgd7VK2RRcxK1zNuSQ755G5Mtxx").unwrap();
        let claim = 140454710;
        let tree_node_hash = TreeNode {
            stake_authority: staker_authority,
            withdraw_authority: withdrawer_authority,
            claim,
            ..TreeNode::default()
        }
        .hash();
        assert!(verify(
            proof,
            merkle_root,
            hash_leaf!(tree_node_hash).to_bytes()
        ));
    }
}
