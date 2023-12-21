use crate::events::{HundrethBasisPointChange, PubkeyValueChange};
use crate::utils::basis_points::HundredthBasisPoint;
use anchor_lang::prelude::*;

#[event]
pub struct InitBondEvent {
    pub config_address: Pubkey,
    pub validator_vote_account: Pubkey,
    pub validator_vote_withdrawer: Pubkey,
    pub authority: Pubkey,
    pub revenue_share: HundredthBasisPoint,
    pub bond_bump: u8,
}

#[event]
pub struct ConfigureBondEvent {
    pub bond_authority: Option<PubkeyValueChange>,
    pub revenue_share: Option<HundrethBasisPointChange>,
}

#[event]
pub struct CloseBondEvent {
    pub config_address: Pubkey,
    pub validator_vote_account: Pubkey,
    pub authority: Pubkey,
    pub revenue_share: HundredthBasisPoint,
    pub bump: u8,
}

#[event]
pub struct FundBondEvent {
    pub bond: Pubkey,
    pub validator_vote: Pubkey,
    pub stake_account: Pubkey,
    pub stake_authority_signer: Pubkey,
    pub deposited_amount: u64,
}
