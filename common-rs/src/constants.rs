use anchor_client::anchor_lang::prelude::Pubkey;

// PROGRAM ID: vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4

// stake withdrawer PDA: 7cgg6KhPd1G8oaoB48RyPDWu7uZs51jUpDYB3eq4VebH
pub const MARINADE_CONFIG_ADDRESS: &str = "vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU";

// stake withdrawer PDA: 8CsAFqTh75jtiYGjTXxCUbWEurQcupNknuYTiaZPhzz3
pub const MARINADE_INSTITUTIONAL_CONFIG_ADDRESS: &str =
    "VbinSTyUEC8JXtzFteC4ruKSfs6dkQUUcY6wB1oJyjE";

// cannot find this in Anchor code
pub fn find_event_authority(config_address: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"__event_authority"], config_address)
}
