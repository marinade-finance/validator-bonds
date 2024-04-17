use anchor_client::anchor_lang::prelude::Pubkey;
use validator_bonds::ID;

pub const MARINADE_CONFIG_ADDRESS: &str = "vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU";

// cannot find this in Anchor code
pub fn find_event_authority() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"__event_authority"], &ID)
}
