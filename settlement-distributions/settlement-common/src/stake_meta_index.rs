use snapshot_parser::stake_meta::StakeMeta;
use solana_sdk::pubkey::Pubkey;
use {snapshot_parser::stake_meta::StakeMetaCollection, std::collections::HashMap};
pub struct StakeMetaIndex<'a> {
    pub stake_meta_collection: &'a StakeMetaCollection,
    index: HashMap<&'a Pubkey, HashMap<(&'a Pubkey, &'a Pubkey), Vec<&'a StakeMeta>>>,
}
impl<'a> StakeMetaIndex<'a> {
    pub fn new(stake_meta_collection: &'a StakeMetaCollection) -> Self {
        let mut index: HashMap<&'a Pubkey, HashMap<(&'a Pubkey, &'a Pubkey), Vec<&'a StakeMeta>>> =
            Default::default();
        for stake_meta in stake_meta_collection.stake_metas.iter() {
            if let Some(validator) = &stake_meta.validator {
                index
                    .entry(validator)
                    .or_default()
                    .entry((&stake_meta.withdraw_authority, &stake_meta.stake_authority))
                    .or_default()
                    .push(stake_meta);
            }
        }

        Self {
            stake_meta_collection,
            index,
        }
    }

    pub fn iter_grouped_stake_metas(
        &self,
        vote_account: &Pubkey,
    ) -> Option<impl Iterator<Item = (&(&Pubkey, &Pubkey), &Vec<&StakeMeta>)>> {
        self.index.get(vote_account).map(|stakers| stakers.iter())
    }
}
