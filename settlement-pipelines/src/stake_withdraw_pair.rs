use solana_sdk::pubkey::Pubkey;

pub struct StakeWithdrawAuthorityPair<'a> {
    pub stake_authority: &'a Pubkey,
    pub withdraw_authority: &'a Pubkey,
}

impl<'a> StakeWithdrawAuthorityPair<'a> {
    pub fn new(stake_authority: &'a Pubkey, withdraw_authority: &'a Pubkey) -> Self {
        Self {
            stake_authority,
            withdraw_authority,
        }
    }
}

impl PartialEq for StakeWithdrawAuthorityPair<'_> {
    fn eq(&self, other: &Self) -> bool {
        self.stake_authority == other.stake_authority
            && self.withdraw_authority == other.withdraw_authority
    }
}

impl Eq for StakeWithdrawAuthorityPair<'_> {}

impl std::hash::Hash for StakeWithdrawAuthorityPair<'_> {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.stake_authority.hash(state);
        self.withdraw_authority.hash(state);
    }
}
