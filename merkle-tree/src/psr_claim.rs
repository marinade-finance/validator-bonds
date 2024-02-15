use {
    serde::{Deserialize, Serialize},
    solana_program::hash::{Hash, Hasher},
    solana_program::pubkey::Pubkey,
};

#[derive(Default, Clone, Eq, Debug, Hash, PartialEq, Deserialize, Serialize)]
pub struct TreeNode {
    pub stake_authority: Pubkey,
    pub withdraw_authority: Pubkey,
    pub vote_account: Pubkey,
    pub claim: u64,
    pub proof: Option<Vec<[u8; 32]>>,
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
