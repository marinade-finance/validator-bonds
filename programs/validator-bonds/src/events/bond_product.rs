use crate::state::bond_product::{ProductType, ProductTypeConfig};
use anchor_lang::prelude::*;

#[event]
pub struct InitBondProductEvent {
    pub bond_product: Pubkey,
    pub config: Pubkey,
    pub bond: Pubkey,
    pub vote_account: Pubkey,
    pub product_type: ProductType,
    pub authority: Option<Pubkey>,
}

#[event]
pub struct ConfigureBondProductEvent {
    pub config: Pubkey,
    pub bond_product: Pubkey,
    pub bond: Pubkey,
    pub vote_account: Pubkey,
    pub product_type: ProductType,
    pub old_config_data: ProductTypeConfig,
    pub new_config_data: ProductTypeConfig,
}
