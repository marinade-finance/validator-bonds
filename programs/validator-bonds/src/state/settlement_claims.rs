use crate::constants::SETTLEMENT_CLAIMS_ANCHOR_HEADER_SIZE;
use crate::utils::BitmapProjection;
use anchor_lang::prelude::Pubkey;
use anchor_lang::prelude::*;
pub use anchor_lang::solana_program::entrypoint::MAX_PERMITTED_DATA_INCREASE;
use solana_system_interface::MAX_PERMITTED_DATA_LENGTH;
use std::fmt::Debug;

/// Account serving to deduplicate claiming, consists of anchor data as metadata header and bitmap in the remaining space.
// Anchor data part ("header") of SettlementClaims Solana account.
// Anchor data provides metadata (account type, settlement...) for the bitmap.
// Bitmap data is stored in the remaining space of the account data after data loaded by Anchor.
// The bitmap structure stores the first index (0) in the most left bit of the most left (first) byte.
#[account()]
#[derive(Debug)]
pub struct SettlementClaims {
    pub settlement: Pubkey,
    pub version: u8,
    pub max_records: u64,
    // data are remaining space in Account, not touched by Anchor to not exceed 32KB on heap data
    // https://github.com/solana-developers/anchor-zero-copy-example/tree/main?tab=readme-ov-file#explanation-of-solana-memory-and-zero-copy
    // data: &mut [u8],

    // Implementation WARNING: When adding new fields, make sure to update SETTLEMENT_CLAIMS_ANCHOR_HEADER_SIZE
}

/// Size of Solana account that stores thee SettlementClaims data from Anchor + number of records in the bitmap.
/// (bitmap data is stored in the remaining space of the account data after data loaded by Anchor)
pub fn account_size(max_records: u64) -> usize {
    SETTLEMENT_CLAIMS_ANCHOR_HEADER_SIZE as usize
        + BitmapProjection::bitmap_size_in_bytes(max_records)
}

pub fn account_initialization_size(max_records: u64) -> Result<usize> {
    let max_size = account_size(max_records);
    if max_size > MAX_PERMITTED_DATA_LENGTH as usize {
        return Err(
            error!(crate::ErrorCode::SettlementClaimsTooManyRecords).with_values((
                "'max_records/max_size bytes' vs. 'requested_records'",
                format!(
                    "'{}/{}' vs. '{}'",
                    MAX_PERMITTED_DATA_LENGTH * 8,
                    max_size,
                    max_records,
                ),
            )),
        );
    }
    if max_size > MAX_PERMITTED_DATA_INCREASE {
        Ok(MAX_PERMITTED_DATA_INCREASE)
    } else {
        Ok(max_size)
    }
}

pub fn account_increase_size(settlement_claims: &Account<'_, SettlementClaims>) -> Result<usize> {
    let max_records = settlement_claims.max_records;
    let max_size = account_size(max_records);
    let current_size = settlement_claims.to_account_info().data.borrow().len();
    let increase_size = max_size.saturating_sub(current_size);
    msg!(
        "Max size: {}, current size: {}, increase size: {}",
        max_size,
        current_size,
        increase_size
    );
    match increase_size {
        0 => Err(crate::ErrorCode::SettlementClaimsAlreadyInitialized.into()),
        num if num > MAX_PERMITTED_DATA_INCREASE => Ok(current_size + MAX_PERMITTED_DATA_INCREASE),
        _ => Ok(max_size),
    }
}

/// An helper wrapper structure that stores (only) references to the account data of SettlementClaims account.
/// It provides utility methods to work with the bitmap data stored in the account after data loaded by Anchor.
pub struct SettlementClaimsWrapped<'info: 'a, 'a> {
    account: &'a Account<'info, SettlementClaims>,
    account_info: AccountInfo<'info>,
    bitmap_projection: BitmapProjection,
}

impl<'info, 'a> SettlementClaimsWrapped<'info, 'a> {
    pub fn new(account: &'a Account<'info, SettlementClaims>) -> Result<Self> {
        let bitmap_projection = BitmapProjection(account.max_records);
        let account_info = account.to_account_info();

        if BitmapProjection::check_size(
            account.max_records,
            &account_info.data.borrow_mut()[SETTLEMENT_CLAIMS_ANCHOR_HEADER_SIZE as usize..],
        )
        .is_err()
        {
            let bitmap_byte_size = BitmapProjection::bitmap_size_in_bytes(account.max_records);
            return Err(
                error!(crate::ErrorCode::SettlementClaimsNotInitialized).with_values((
                    "'max_records/required_byte_size' : 'current_byte_size'",
                    format!(
                        "'{}/{}' : '{}'",
                        account.max_records,
                        SETTLEMENT_CLAIMS_ANCHOR_HEADER_SIZE as usize + bitmap_byte_size,
                        account_info.data.borrow().len(),
                    ),
                )),
            );
        }

        Ok(Self {
            account,
            account_info,
            bitmap_projection,
        })
    }

    pub fn try_to_set(&mut self, index: u64) -> Result<bool> {
        self.bitmap_projection.try_to_set(
            index,
            &mut self.account_info.data.borrow_mut()
                [SETTLEMENT_CLAIMS_ANCHOR_HEADER_SIZE as usize..],
        )
    }
}

impl Debug for SettlementClaimsWrapped<'_, '_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SettlementClaims")
            .field("account", &self.account)
            .field(
                "bitmap",
                &self.bitmap_projection.debug_string(
                    &self.account_info.data.borrow()
                        [SETTLEMENT_CLAIMS_ANCHOR_HEADER_SIZE as usize..],
                ),
            )
            .finish()
    }
}

#[cfg(test)]
mod proptests {
    use super::*;
    use crate::ID;
    use proptest::prelude::*;

    const MAX_LEN: usize = MAX_PERMITTED_DATA_LENGTH as usize;
    const INCREASE: usize = MAX_PERMITTED_DATA_INCREASE;

    fn max_records_strategy() -> impl Strategy<Value = u64> {
        let max_fit = (MAX_LEN - SETTLEMENT_CLAIMS_ANCHOR_HEADER_SIZE as usize) as u64 * 8;
        prop_oneof![
            0u64..200_000,
            (max_fit - 20)..(max_fit + 20),
            0u64..(max_fit * 2),
            any::<u64>(),
        ]
    }

    proptest! {
        #[test]
        fn account_size_is_header_plus_bitmap(n in any::<u64>()) {
            let size = account_size(n) as u128;
            prop_assert_eq!(size, SETTLEMENT_CLAIMS_ANCHOR_HEADER_SIZE as u128 + (n as u128).div_ceil(8));
        }

        #[test]
        fn initialization_size_is_bounded_and_covers_header(n in max_records_strategy()) {
            let full = account_size(n);
            match account_initialization_size(n) {
                Ok(size) => {
                    prop_assert!(full <= MAX_LEN);
                    prop_assert_eq!(size, full.min(INCREASE));
                    prop_assert!(size >= SETTLEMENT_CLAIMS_ANCHOR_HEADER_SIZE as usize);
                }
                Err(_) => prop_assert!(full > MAX_LEN),
            }
        }

    }

    proptest! {
        // each case walks several reallocation steps
        #![proptest_config(ProptestConfig::with_cases(32))]

        #[test]
        fn upsizing_converges_to_full_bitmap_size(n in 0u64..(INCREASE as u64 * 8 * 12)) {
            let full = account_size(n);
            let mut current = account_initialization_size(n).unwrap();
            let mut steps = 0usize;
            loop {
                let mut data = vec![0u8; current];
                let claims = SettlementClaims { settlement: Pubkey::new_unique(), version: 0, max_records: n };
                let mut head = Vec::new();
                claims.try_serialize(&mut head).unwrap();
                prop_assert!(head.len() <= SETTLEMENT_CLAIMS_ANCHOR_HEADER_SIZE as usize);
                data[..head.len()].copy_from_slice(&head);
                let key = Pubkey::new_unique();
                let mut lamports = 1u64;
                let info = AccountInfo::new(&key, false, true, &mut lamports, &mut data, &ID, false);
                let account: Account<SettlementClaims> = Account::try_from(&info).unwrap();
                match account_increase_size(&account) {
                    Err(_) => {
                        // nothing left to grow
                        prop_assert_eq!(current, full);
                        break;
                    }
                    Ok(next) => {
                        prop_assert!(next > current);
                        prop_assert!(next - current <= INCREASE);
                        prop_assert!(next <= full);
                        current = next;
                    }
                }
                steps += 1;
                prop_assert!(steps <= MAX_LEN / INCREASE + 2);
            }
        }
    }
}
