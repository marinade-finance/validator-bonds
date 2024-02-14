use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program;
use anchor_lang::solana_program::hash::{hashv, Hash, Hasher};

const LEAF_PREFIX: &[u8] = &[0];
const INTERMEDIATE_PREFIX: &[u8] = &[1];

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
            computed_hash =
                solana_program::hash::hashv(&[INTERMEDIATE_PREFIX, &computed_hash, &proof_element])
                    .to_bytes();
        } else {
            // Hash(current element of the proof + current computed hash)
            computed_hash =
                solana_program::hash::hashv(&[INTERMEDIATE_PREFIX, &proof_element, &computed_hash])
                    .to_bytes();
        }
    }
    // Check if the computed hash (root) is equal to the provided root
    computed_hash == root
}

// TODO: the TreeNode implementation should be shared with insurance-engine in a lib
#[derive(Default, Clone, Eq, Debug, PartialEq)]
pub struct TreeNode {
    pub stake_authority: String,
    pub withdraw_authority: String,
    pub vote_account: String,
    pub claim: u64,
}

impl TreeNode {
    pub fn hash(&self) -> Hash {
        let mut hasher = Hasher::default();
        hasher.hash(self.stake_authority.as_ref());
        hasher.hash(self.withdraw_authority.as_ref());
        hasher.hash(self.vote_account.as_ref());
        hasher.hash(self.claim.to_le_bytes().as_ref());
        hasher.result()
    }
}

pub fn tree_node_leaf_hash(
    stake_authority: Pubkey,
    withdraw_authority: Pubkey,
    vote_account: Pubkey,
    claim: u64,
) -> [u8; 32] {
    let tree_node = TreeNode {
        stake_authority: stake_authority.to_string(),
        withdraw_authority: withdraw_authority.to_string(),
        vote_account: vote_account.to_string(),
        claim,
    };
    hashv(&[LEAF_PREFIX, tree_node.hash().as_ref()]).to_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    // data from google cloud bucket marinade-validator-bonds-mainnet / 538 / claims_merkle_all.json
    #[test]
    pub fn claim_merkle_check() {
        let merkle_root: [u8; 32] = [
            202, 130, 41, 31, 241, 150, 255, 231, 116, 191, 34, 45, 7, 52, 229, 14, 38, 152, 205,
            35, 77, 129, 150, 69, 222, 165, 118, 21, 245, 196, 12, 8,
        ];
        let proof: Vec<[u8; 32]> = vec![
            [
                47, 75, 189, 246, 10, 208, 167, 241, 94, 159, 85, 40, 91, 30, 223, 106, 220, 124,
                75, 250, 101, 56, 211, 47, 245, 223, 180, 120, 212, 165, 46, 230,
            ],
            [
                127, 197, 84, 130, 51, 93, 240, 21, 203, 178, 114, 65, 149, 21, 1, 77, 192, 83,
                161, 189, 16, 77, 79, 229, 15, 164, 240, 229, 130, 169, 192, 62,
            ],
            [
                193, 157, 141, 77, 139, 99, 107, 20, 229, 4, 14, 107, 226, 181, 253, 160, 121, 86,
                41, 142, 48, 129, 206, 67, 135, 7, 128, 121, 138, 173, 159, 226,
            ],
            [
                98, 34, 3, 217, 2, 0, 217, 10, 160, 147, 130, 23, 50, 15, 101, 111, 95, 0, 69, 42,
                252, 44, 9, 212, 93, 87, 46, 61, 194, 200, 131, 87,
            ],
            [
                202, 162, 200, 68, 95, 9, 35, 95, 179, 173, 138, 39, 234, 239, 39, 85, 75, 174, 18,
                251, 148, 19, 27, 183, 155, 207, 7, 146, 33, 89, 151, 182,
            ],
            [
                220, 226, 167, 7, 176, 225, 22, 53, 179, 157, 222, 98, 178, 20, 153, 129, 49, 62,
                123, 241, 231, 149, 216, 228, 211, 190, 222, 75, 61, 119, 218, 70,
            ],
            [
                5, 97, 219, 39, 220, 79, 11, 27, 35, 233, 160, 92, 167, 231, 105, 252, 132, 32,
                134, 207, 61, 83, 33, 38, 187, 40, 2, 21, 24, 241, 52, 235,
            ],
            [
                252, 120, 230, 147, 222, 95, 139, 227, 60, 192, 120, 130, 228, 200, 116, 172, 1,
                195, 200, 216, 3, 153, 183, 120, 227, 142, 199, 208, 206, 208, 42, 184,
            ],
            [
                191, 43, 110, 21, 71, 233, 71, 165, 62, 240, 247, 117, 100, 89, 2, 151, 234, 151,
                248, 249, 8, 125, 196, 163, 227, 191, 253, 191, 22, 198, 134, 214,
            ],
            [
                25, 37, 255, 106, 115, 158, 231, 111, 253, 79, 67, 151, 115, 189, 90, 39, 148, 112,
                158, 1, 221, 170, 88, 37, 186, 83, 187, 44, 17, 197, 39, 98,
            ],
            [
                84, 68, 113, 241, 254, 22, 178, 79, 231, 244, 228, 246, 119, 82, 122, 11, 70, 57,
                112, 196, 133, 244, 240, 151, 153, 232, 220, 16, 127, 152, 151, 126,
            ],
            [
                26, 223, 34, 53, 66, 20, 36, 57, 19, 91, 164, 97, 213, 63, 59, 164, 171, 216, 32,
                165, 119, 138, 17, 25, 169, 133, 202, 218, 251, 136, 67, 53,
            ],
            [
                81, 183, 91, 133, 233, 179, 189, 96, 37, 60, 196, 32, 22, 75, 153, 172, 130, 2, 70,
                21, 184, 12, 244, 6, 40, 200, 149, 249, 100, 177, 201, 234,
            ],
        ];
        let staker_authority =
            Pubkey::from_str("A8fPZYZYQ15achgZvxUn4pzxjWqUU5gNuwvKgwLCegCT").unwrap();
        let withdrawer_authority =
            Pubkey::from_str("A8fPZYZYQ15achgZvxUn4pzxjWqUU5gNuwvKgwLCegCT").unwrap();
        let vote_account =
            Pubkey::from_str("DdCNGDpP7qMgoAy6paFzhhak2EeyCZcgjH7ak5u5v28m").unwrap();
        let claim = 3101;
        assert!(verify(
            proof,
            merkle_root,
            tree_node_leaf_hash(staker_authority, withdrawer_authority, vote_account, claim)
        ));
    }
}
