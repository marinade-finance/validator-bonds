use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::hash::{Hash, Hasher};
use serde::{Deserialize, Serialize};

#[derive(Default, Clone, Eq, Debug, Hash, PartialEq, Deserialize, Serialize)]
pub struct TreeNodeV1 {
    pub stake_authority: Pubkey,
    pub withdraw_authority: Pubkey,
    pub claim: u64,
    pub proof: Option<Vec<[u8; 32]>>,
}

impl TreeNodeV1 {
    pub fn hash(&self) -> Hash {
        let mut hasher = Hasher::default();
        hasher.hash(self.stake_authority.as_ref());
        hasher.hash(self.withdraw_authority.as_ref());
        hasher.hash(self.claim.to_le_bytes().as_ref());
        hasher.result()
    }
}
