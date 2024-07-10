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

    // TODO: probably good to download test data from gcloud when available
    // data manually generated with indexes from ... / 628 / claims_merkle_all.json
    #[test]
    pub fn claim_merkle_check() {
        let merkle_root: [u8; 32] = [
            152, 222, 39, 238, 168, 62, 172, 145, 190, 108, 240, 29, 242, 149, 107, 254, 132, 5,
            193, 202, 15, 75, 245, 143, 136, 231, 31, 219, 104, 164, 37, 1,
        ];
        let proof: Vec<[u8; 32]> = vec![
            [
                86, 116, 94, 143, 105, 251, 38, 132, 33, 138, 181, 251, 39, 231, 16, 234, 77, 54,
                81, 155, 68, 59, 49, 231, 58, 145, 148, 77, 87, 212, 28, 114,
            ],
            [
                139, 171, 147, 33, 131, 207, 134, 120, 120, 243, 232, 172, 94, 194, 55, 85, 157,
                89, 41, 164, 191, 176, 33, 77, 193, 146, 173, 111, 2, 201, 59, 12,
            ],
            [
                37, 229, 189, 203, 125, 111, 234, 201, 98, 52, 191, 6, 67, 154, 176, 183, 253, 25,
                146, 190, 196, 255, 36, 45, 246, 8, 86, 104, 51, 73, 113, 7,
            ],
        ];
        let staker_authority =
            Pubkey::from_str("mpa4abUkjQoAvPzREkh5Mo75hZhPFQ2FSH6w7dWKuQ5").unwrap();
        let withdrawer_authority =
            Pubkey::from_str("4ZJhPQAgUseCsWhKvJLTmmRRUV74fdoTpQLNfKoekbPY").unwrap();
        let claim = 317437558;
        let index = 3;
        let tree_node_hash = TreeNode {
            stake_authority: staker_authority,
            withdraw_authority: withdrawer_authority,
            claim,
            index,
            proof: None,
        }
        .hash();
        assert!(verify(
            proof,
            merkle_root,
            hash_leaf!(tree_node_hash).to_bytes()
        ));
    }
}
