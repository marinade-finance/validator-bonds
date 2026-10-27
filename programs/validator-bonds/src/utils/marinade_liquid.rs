use crate::error::ErrorCode;
use anchor_lang::prelude::*;
use solana_program::pubkey::PUBKEY_BYTES;
use std::slice::ChunksExact;

pub const STATE_STAKE_LIST_ACCOUNT_OFFSET: usize = 150;
pub const STATE_STAKE_LIST_ITEM_SIZE_OFFSET: usize = 182;
pub const STATE_STAKE_LIST_COUNT_OFFSET: usize = 186;
pub const STATE_MIN_LEN: usize = 190;
pub const STAKE_LIST_DISCRIMINATOR: [u8; 8] = *b"staker__";
pub const STAKE_LIST_HEADER_LEN: usize = 8;

/// Marinade liquid `State.stake_system.stake_list` header, read from raw account data
pub struct StakeListMeta {
    pub account: Pubkey,
    pub item_size: usize,
    pub count: usize,
}

fn read_u32(data: &[u8], offset: usize) -> usize {
    u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap()) as usize
}

fn read_u64(data: &[u8]) -> u64 {
    u64::from_le_bytes(data[..8].try_into().unwrap())
}

/// Reads the stake list header from the Marinade liquid State account data.
pub fn parse_state_stake_list_meta(state_data: &[u8]) -> Result<StakeListMeta> {
    let data = state_data
        .get(..STATE_MIN_LEN)
        .ok_or(ErrorCode::InvalidMarinadeLiquidAccount)?;
    let item_size = read_u32(data, STATE_STAKE_LIST_ITEM_SIZE_OFFSET);
    require_gte!(
        item_size,
        PUBKEY_BYTES,
        ErrorCode::InvalidMarinadeLiquidAccount
    );
    Ok(StakeListMeta {
        account: Pubkey::new_from_array(
            data[STATE_STAKE_LIST_ACCOUNT_OFFSET..STATE_STAKE_LIST_ITEM_SIZE_OFFSET]
                .try_into()
                .unwrap(),
        ),
        item_size,
        count: read_u32(data, STATE_STAKE_LIST_COUNT_OFFSET),
    })
}

/// Returns the live stake list records; records past `count` are stale leftovers of swap-remove.
pub fn stake_list_records<'a>(
    list_data: &'a [u8],
    meta: &StakeListMeta,
) -> Result<ChunksExact<'a, u8>> {
    let end = meta
        .count
        .checked_mul(meta.item_size)
        .and_then(|len| len.checked_add(STAKE_LIST_HEADER_LEN))
        .ok_or(ErrorCode::InvalidMarinadeLiquidAccount)?;
    let data = list_data
        .get(..end)
        .ok_or(ErrorCode::InvalidMarinadeLiquidAccount)?;
    require!(
        data[..STAKE_LIST_HEADER_LEN] == STAKE_LIST_DISCRIMINATOR,
        ErrorCode::InvalidMarinadeLiquidAccount
    );
    Ok(data[STAKE_LIST_HEADER_LEN..].chunks_exact(meta.item_size))
}

/// Checks whether `key` is the stake account of a live stake list record.
pub fn stake_list_contains(list_data: &[u8], meta: &StakeListMeta, key: &Pubkey) -> Result<bool> {
    let key = key.as_ref();
    let prefix = read_u64(key);
    Ok(stake_list_records(list_data, meta)?
        .any(|record| read_u64(record) == prefix && &record[..PUBKEY_BYTES] == key))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::{
        MARINADE_LIQUID_PROGRAM_ID, MARINADE_LIQUID_STAKE_WITHDRAW_AUTHORITY, MARINADE_LIQUID_STATE,
    };

    const ITEM_SIZE: usize = 56;

    fn state_data(stake_list: &Pubkey, item_size: u32, count: u32) -> Vec<u8> {
        let mut data = vec![0u8; 2616];
        data[STATE_STAKE_LIST_ACCOUNT_OFFSET..STATE_STAKE_LIST_ITEM_SIZE_OFFSET]
            .copy_from_slice(stake_list.as_ref());
        data[STATE_STAKE_LIST_ITEM_SIZE_OFFSET..STATE_STAKE_LIST_COUNT_OFFSET]
            .copy_from_slice(&item_size.to_le_bytes());
        data[STATE_STAKE_LIST_COUNT_OFFSET..STATE_MIN_LEN].copy_from_slice(&count.to_le_bytes());
        data
    }

    fn list_data(records: &[Pubkey], capacity: usize) -> Vec<u8> {
        let mut data = vec![0u8; STAKE_LIST_HEADER_LEN + capacity * ITEM_SIZE];
        data[..STAKE_LIST_HEADER_LEN].copy_from_slice(&STAKE_LIST_DISCRIMINATOR);
        for (i, record) in records.iter().enumerate() {
            let offset = STAKE_LIST_HEADER_LEN + i * ITEM_SIZE;
            data[offset..offset + PUBKEY_BYTES].copy_from_slice(record.as_ref());
        }
        data
    }

    fn meta(count: usize) -> StakeListMeta {
        StakeListMeta {
            account: Pubkey::new_unique(),
            item_size: ITEM_SIZE,
            count,
        }
    }

    #[test]
    fn withdraw_authority_is_derived_from_state() {
        let (withdraw_authority, _) = Pubkey::find_program_address(
            &[MARINADE_LIQUID_STATE.as_ref(), b"withdraw"],
            &MARINADE_LIQUID_PROGRAM_ID,
        );
        assert_eq!(withdraw_authority, MARINADE_LIQUID_STAKE_WITHDRAW_AUTHORITY);
    }

    #[test]
    fn parse_state_reads_mainnet_offsets() {
        let stake_list = Pubkey::new_unique();
        let meta = parse_state_stake_list_meta(&state_data(&stake_list, 56, 487)).unwrap();
        assert_eq!(meta.account, stake_list);
        assert_eq!(meta.item_size, 56);
        assert_eq!(meta.count, 487);
    }

    #[test]
    fn parse_state_rejects_short_data() {
        let data = state_data(&Pubkey::new_unique(), 56, 487);
        assert!(parse_state_stake_list_meta(&data[..STATE_MIN_LEN - 1]).is_err());
    }

    #[test]
    fn parse_state_rejects_item_size_below_pubkey() {
        let data = state_data(&Pubkey::new_unique(), 31, 487);
        assert!(parse_state_stake_list_meta(&data).is_err());
    }

    #[test]
    fn records_reject_wrong_discriminator() {
        let mut data = list_data(&[Pubkey::new_unique()], 2);
        data[..STAKE_LIST_HEADER_LEN].copy_from_slice(b"stakerXX");
        assert!(stake_list_records(&data, &meta(1)).is_err());
    }

    #[test]
    fn records_reject_count_past_data() {
        let data = list_data(&[Pubkey::new_unique()], 2);
        assert!(stake_list_records(&data, &meta(2)).is_ok());
        assert!(stake_list_records(&data, &meta(3)).is_err());
        assert!(stake_list_records(&data, &meta(usize::MAX)).is_err());
    }

    #[test]
    fn contains_hits_first_and_last_live_record() {
        let records: Vec<Pubkey> = (0..5).map(|_| Pubkey::new_unique()).collect();
        let data = list_data(&records, 10);
        for record in &records {
            assert!(stake_list_contains(&data, &meta(5), record).unwrap());
        }
        assert!(!stake_list_contains(&data, &meta(5), &Pubkey::new_unique()).unwrap());
    }

    #[test]
    fn contains_ignores_stale_record_at_count() {
        let records: Vec<Pubkey> = (0..3).map(|_| Pubkey::new_unique()).collect();
        let data = list_data(&records, 10);
        assert!(!stake_list_contains(&data, &meta(2), &records[2]).unwrap());
    }

    #[test]
    fn contains_false_on_prefix_only_match() {
        let listed = Pubkey::new_unique();
        let mut other = listed.to_bytes();
        other[31] ^= 1;
        let data = list_data(&[listed], 1);
        assert!(!stake_list_contains(&data, &meta(1), &Pubkey::new_from_array(other)).unwrap());
    }
}
