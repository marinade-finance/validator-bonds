use anchor_lang::prelude::Pubkey;
use serde::{Deserialize, Serialize};
use solana_program::hash::{hashv, Hash};

#[derive(Default, Clone, Eq, Debug, Hash, PartialEq, Deserialize, Serialize)]
pub struct TreeNodeV1 {
    pub stake_authority: Pubkey,
    pub withdraw_authority: Pubkey,
    pub claim: u64,
    pub proof: Option<Vec<[u8; 32]>>,
}

impl TreeNodeV1 {
    pub fn hash(&self) -> Hash {
        hashv(&[
            self.stake_authority.as_ref(),
            self.withdraw_authority.as_ref(),
            self.claim.to_le_bytes().as_ref(),
        ])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tree_node_v1_hash_is_pinned() {
        let node = TreeNodeV1 {
            stake_authority: Pubkey::new_from_array([1; 32]),
            withdraw_authority: Pubkey::new_from_array([2; 32]),
            claim: 1_000_000_000,
            proof: None,
        };
        let expected: [u8; 32] = [
            0x27, 0x36, 0x9c, 0x91, 0xfa, 0x7b, 0x63, 0x7c, 0x39, 0x9e, 0x10, 0x04, 0xb6, 0x2c,
            0xe0, 0x58, 0xc0, 0xce, 0x66, 0x00, 0xbe, 0x2b, 0x1d, 0x46, 0x28, 0x96, 0x97, 0xf5,
            0xd4, 0xab, 0x72, 0x4e,
        ];
        assert_eq!(node.hash().to_bytes(), expected);
    }
}
