use anchor_client::anchor_lang::prelude::Pubkey;

// PROGRAM ID: vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4
use validator_bonds::ID;

// stake withdrawer PDA: 7cgg6KhPd1G8oaoB48RyPDWu7uZs51jUpDYB3eq4VebH
pub const MARINADE_CONFIG_ADDRESS: &str = "vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU";

// stake withdrawer PDA: 8CsAFqTh75jtiYGjTXxCUbWEurQcupNknuYTiaZPhzz3
pub const MARINADE_INSTITUTIONAL_CONFIG_ADDRESS: &str =
    "VbinSTyUEC8JXtzFteC4ruKSfs6dkQUUcY6wB1oJyjE";

// stake authorities the direct-staking product delegates under; kept in sync with
// settlement-config-direct-staking.yaml's whitelist_stake_authorities
pub const DIRECT_STAKING_STAKE_AUTHORITY: &str = "psrStL2hNx4c7hLUUks8SmDngeYriB8pF7uyHFhM8ir";
pub const DIRECT_STAKING_EXIT_STAKE_AUTHORITY: &str =
    "ExPsrC88dVCUozsuHFXYYpVGytsvwB9vWhwicuaFiypb";

// this method is not available from Anchor code
pub fn find_event_authority() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"__event_authority"], &ID)
}
