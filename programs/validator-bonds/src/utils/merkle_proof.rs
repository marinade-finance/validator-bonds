use merkle_tree::{hash_intermediate, INTERMEDIATE_PREFIX};
use solana_program::hash::hashv;

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
    use anchor_lang::solana_program::pubkey::Pubkey;
    use merkle_tree::psr_claim::TreeNode;
    use merkle_tree::{hash_leaf, LEAF_PREFIX};
    use solana_program::hash::hashv;
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

#[cfg(test)]
mod proptests {
    use super::verify;
    use merkle_tree::psr_claim::TreeNode;
    use merkle_tree::{hash_intermediate, hash_leaf, MerkleTree, INTERMEDIATE_PREFIX, LEAF_PREFIX};
    use proptest::collection::vec;
    use proptest::prelude::*;
    use solana_program::hash::hashv;
    use solana_program::pubkey::Pubkey;

    #[derive(Debug, Clone)]
    struct Tree {
        nodes: Vec<TreeNode>,
        root: [u8; 32],
        proofs: Vec<Vec<[u8; 32]>>,
    }

    // same construction as the off-chain merkle generator: node hash -> leaf hash -> sorted tree
    fn build(nodes: Vec<TreeNode>) -> Tree {
        let hashed: Vec<[u8; 32]> = nodes.iter().map(|n| n.hash().to_bytes()).collect();
        let tree = MerkleTree::new(&hashed[..], true);
        let proofs = (0..nodes.len())
            .map(|i| {
                tree.find_path(i)
                    .unwrap()
                    .get_proof_entries()
                    .iter()
                    .map(|e| {
                        e.get_left_sibling()
                            .or(e.get_right_sibling())
                            .unwrap()
                            .to_bytes()
                    })
                    .collect()
            })
            .collect();
        Tree {
            nodes,
            root: tree.get_root().unwrap().to_bytes(),
            proofs,
        }
    }

    fn leaf_of(node: &TreeNode) -> [u8; 32] {
        let h = node.hash().to_bytes();
        hash_leaf!(h).to_bytes()
    }

    fn trees() -> impl Strategy<Value = Tree> {
        vec((any::<[u8; 32]>(), any::<[u8; 32]>(), any::<u64>()), 1..40).prop_map(|v| {
            build(
                v.into_iter()
                    .enumerate()
                    .map(|(i, (s, w, claim))| TreeNode {
                        stake_authority: Pubkey::new_from_array(s),
                        withdraw_authority: Pubkey::new_from_array(w),
                        claim,
                        index: i as u64,
                        proof: None,
                    })
                    .collect(),
            )
        })
    }

    proptest! {
        #[test]
        fn every_leaf_verifies(t in trees()) {
            for (node, proof) in t.nodes.iter().zip(&t.proofs) {
                prop_assert!(verify(proof.clone(), t.root, leaf_of(node)));
            }
        }

        #[test]
        fn tampered_leaf_fields_do_not_verify(t in trees(), which in 0usize..4, pick in any::<prop::sample::Index>()) {
            let i = pick.index(t.nodes.len());
            let mut node = t.nodes[i].clone();
            match which {
                0 => node.claim = node.claim.wrapping_add(1),
                1 => node.index = node.index.wrapping_add(1),
                2 => node.stake_authority = Pubkey::new_unique(),
                _ => node.withdraw_authority = Pubkey::new_unique(),
            }
            prop_assert!(!verify(t.proofs[i].clone(), t.root, leaf_of(&node)));
        }

        #[test]
        fn tampered_proof_or_root_does_not_verify(
            t in trees(),
            pick in any::<prop::sample::Index>(),
            elem in any::<prop::sample::Index>(),
            bit in 0usize..256,
        ) {
            let i = pick.index(t.nodes.len());
            let leaf = leaf_of(&t.nodes[i]);
            let flip = |mut h: [u8; 32]| { h[bit / 8] ^= 1 << (bit % 8); h };
            let bad_root = flip(t.root);
            prop_assert!(!verify(t.proofs[i].clone(), bad_root, leaf));
            if !t.proofs[i].is_empty() {
                let mut p = t.proofs[i].clone();
                let k = elem.index(p.len());
                p[k] = flip(p[k]);
                prop_assert!(!verify(p, t.root, leaf));
                // dropping a level, or appending one, changes the result
                let mut shorter = t.proofs[i].clone();
                shorter.pop();
                prop_assert!(!verify(shorter, t.root, leaf));
            }
            let mut longer = t.proofs[i].clone();
            longer.push([0u8; 32]);
            prop_assert!(!verify(longer, t.root, leaf));
        }

        #[test]
        fn proof_of_one_leaf_does_not_fit_another(t in trees(), a in any::<prop::sample::Index>(), b in any::<prop::sample::Index>()) {
            let (i, j) = (a.index(t.nodes.len()), b.index(t.nodes.len()));
            if i == j {
                return Ok(());
            }
            // a different leaf may share a proof only if the path happens to be identical
            // for both, in which case the leaves hash to the same value
            if !verify(t.proofs[i].clone(), t.root, leaf_of(&t.nodes[j])) {
                return Ok(());
            }
            prop_assert_eq!(leaf_of(&t.nodes[i]), leaf_of(&t.nodes[j]));
        }

        #[test]
        fn intermediate_node_is_not_a_leaf_hash(l in any::<[u8; 32]>(), r in any::<[u8; 32]>()) {
            // a node hash is never the leaf hash of the concatenated children
            let mut concat = l.to_vec();
            concat.extend_from_slice(&r);
            let leaf = hash_leaf!(concat).to_bytes();
            let inner = hash_intermediate!(l, r).to_bytes();
            prop_assert_ne!(leaf, inner);
            // and the verifier does not accept a bare leaf hash as a one-level tree
            prop_assert!(!verify(vec![], inner, leaf));
        }

        #[test]
        fn empty_proof_means_leaf_is_root(leaf in any::<[u8; 32]>(), root in any::<[u8; 32]>()) {
            prop_assert_eq!(verify(vec![], root, leaf), leaf == root);
        }
    }
}
