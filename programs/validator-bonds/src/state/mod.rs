use anchor_lang::prelude::*;

pub mod bond;
pub mod config;
pub mod settlement;
pub mod settlement_claim;
pub mod withdraw_request;

#[derive(AnchorDeserialize, AnchorSerialize, Clone, Debug)]
pub struct Reserved150 {
    pub reserved: [u8; 150],
}

impl Default for Reserved150 {
    fn default() -> Self {
        Self { reserved: [0; 150] }
    }
}
