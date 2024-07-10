use anchor_lang::prelude::*;

#[constant]
pub const PROGRAM_ID: &str = "vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4";

// NOTE: anchor-0.29: constants cannot be used in anchor #[Account] when seeds = true
//       https://github.com/coral-xyz/anchor/issues/2697

#[constant]
pub const BOND_SEED: &[u8] = b"bond_account";

#[constant]
pub const BOND_MINT_SEED: &[u8] = b"bond_mint";
#[constant]
pub const SETTLEMENT_SEED: &[u8] = b"settlement_account";
#[constant]
pub const WITHDRAW_REQUEST_SEED: &[u8] = b"withdraw_account";

#[constant]
pub const BONDS_WITHDRAWER_AUTHORITY_SEED: &[u8] = b"bonds_authority";

#[constant]
pub const SETTLEMENT_STAKER_AUTHORITY_SEED: &[u8] = b"settlement_authority";

#[constant]
pub const SETTLEMENT_CLAIMS_SEED: &[u8] = b"claims_account";

pub const MIN_STAKE_LAMPORTS: u64 = 1_000_000_000;

// 8 + mem::size_of::<SettlementClaims>(): 8 + 32 + 1 + 8 = 49 bytes
// Anchor aligns to 8 bytes, so data part that Anchor uses for saving data is 56 bytes
#[constant]
pub const SETTLEMENT_CLAIMS_ANCHOR_HEADER_SIZE: u8 = 56;
