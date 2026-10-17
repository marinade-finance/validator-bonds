use {
    crate::serde_serialize::{pubkey_string_conversion, u64_number_or_string},
    serde::{Deserialize, Serialize},
    solana_program::hash::{hashv, Hash},
    solana_program::pubkey::Pubkey,
};

#[derive(Default, Clone, Eq, Debug, Hash, PartialEq, Deserialize, Serialize)]
pub struct TreeNode {
    #[serde(with = "pubkey_string_conversion")]
    pub stake_authority: Pubkey,
    #[serde(with = "pubkey_string_conversion")]
    pub withdraw_authority: Pubkey,
    #[serde(with = "u64_number_or_string")]
    pub claim: u64,
    pub index: u64,
    pub proof: Option<Vec<[u8; 32]>>,
}

impl TreeNode {
    pub fn hash(&self) -> Hash {
        hashv(&[
            self.stake_authority.as_ref(),
            self.withdraw_authority.as_ref(),
            self.claim.to_le_bytes().as_ref(),
            self.index.to_le_bytes().as_ref(),
        ])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tree_node_hash_is_pinned() {
        let node = TreeNode {
            stake_authority: Pubkey::new_from_array([1; 32]),
            withdraw_authority: Pubkey::new_from_array([2; 32]),
            claim: 1_000_000_000,
            index: 7,
            proof: None,
        };
        assert_eq!(
            hex::encode(node.hash().to_bytes()),
            "0d213f24619f82e6a9051dcf851ded2cdea17402da115bf7c1d53d15dde73334"
        );
    }
}
