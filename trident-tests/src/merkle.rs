//! Minimal merkle tree matching the on-chain verifier
//! (`programs/validator-bonds/src/utils/merkle_proof.rs`): sha256, leaf prefix 0, node prefix 1, sorted pairs.

use sha2::{Digest, Sha256};
use trident_fuzz::fuzzing::Pubkey;

#[derive(Clone, Debug)]
pub struct Leaf {
    pub staker: Pubkey,
    pub withdrawer: Pubkey,
    pub claim: u64,
    pub index: u64,
}

impl Leaf {
    /// `TreeNode::hash` of the merkle-tree crate.
    pub fn node_hash(&self) -> [u8; 32] {
        let mut h = Sha256::new();
        h.update(self.staker.as_ref());
        h.update(self.withdrawer.as_ref());
        h.update(self.claim.to_le_bytes());
        h.update(self.index.to_le_bytes());
        h.finalize().into()
    }
}

fn hash_leaf(node_hash: &[u8; 32]) -> [u8; 32] {
    Sha256::new()
        .chain_update([0u8])
        .chain_update(node_hash)
        .finalize()
        .into()
}

fn hash_pair(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let (l, r) = if a <= b { (a, b) } else { (b, a) };
    Sha256::new()
        .chain_update([1u8])
        .chain_update(l)
        .chain_update(r)
        .finalize()
        .into()
}

pub struct Tree {
    levels: Vec<Vec<[u8; 32]>>,
}

impl Tree {
    pub fn new(leaves: &[Leaf]) -> Self {
        let mut levels = vec![leaves
            .iter()
            .map(|l| hash_leaf(&l.node_hash()))
            .collect::<Vec<_>>()];
        while levels.last().unwrap().len() > 1 {
            let cur = levels.last().unwrap();
            let next = cur
                .chunks(2)
                .map(|c| {
                    if c.len() == 2 {
                        hash_pair(&c[0], &c[1])
                    } else {
                        c[0]
                    }
                })
                .collect();
            levels.push(next);
        }
        Tree { levels }
    }

    pub fn root(&self) -> [u8; 32] {
        self.levels.last().unwrap()[0]
    }

    pub fn proof(&self, mut i: usize) -> Vec<[u8; 32]> {
        let mut out = vec![];
        for level in &self.levels[..self.levels.len() - 1] {
            let sib = i ^ 1;
            if sib < level.len() {
                out.push(level[sib]);
            }
            i /= 2;
        }
        out
    }
}
