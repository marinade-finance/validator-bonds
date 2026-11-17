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

#[cfg(test)]
mod proptests {
    use super::*;
    use proptest::collection::vec;
    use proptest::prelude::*;

    fn state_bytes(account: [u8; 32], item_size: u32, count: u32, tail: usize) -> Vec<u8> {
        let mut data = vec![0u8; STATE_MIN_LEN + tail];
        data[STATE_STAKE_LIST_ACCOUNT_OFFSET..STATE_STAKE_LIST_ITEM_SIZE_OFFSET]
            .copy_from_slice(&account);
        data[STATE_STAKE_LIST_ITEM_SIZE_OFFSET..STATE_STAKE_LIST_COUNT_OFFSET]
            .copy_from_slice(&item_size.to_le_bytes());
        data[STATE_STAKE_LIST_COUNT_OFFSET..STATE_MIN_LEN].copy_from_slice(&count.to_le_bytes());
        data
    }

    fn list_bytes(records: &[[u8; 32]], item_size: usize, capacity: usize, fill: u8) -> Vec<u8> {
        let mut data = vec![fill; STAKE_LIST_HEADER_LEN + capacity * item_size];
        data[..STAKE_LIST_HEADER_LEN].copy_from_slice(&STAKE_LIST_DISCRIMINATOR);
        for (i, r) in records.iter().enumerate() {
            let o = STAKE_LIST_HEADER_LEN + i * item_size;
            data[o..o + 32].copy_from_slice(r);
        }
        data
    }

    proptest! {
        #[test]
        fn parse_state_never_panics(data in vec(any::<u8>(), 0..400)) {
            let res = parse_state_stake_list_meta(&data);
            if data.len() < STATE_MIN_LEN {
                prop_assert!(res.is_err());
            } else {
                let size = u32::from_le_bytes(data[182..186].try_into().unwrap()) as usize;
                prop_assert_eq!(res.is_ok(), size >= PUBKEY_BYTES);
            }
        }

        #[test]
        fn parse_state_roundtrips(
            account in any::<[u8; 32]>(),
            item_size in 32u32..,
            count in any::<u32>(),
            tail in 0usize..64,
        ) {
            let meta = parse_state_stake_list_meta(&state_bytes(account, item_size, count, tail)).unwrap();
            prop_assert_eq!(meta.account.to_bytes(), account);
            prop_assert_eq!(meta.item_size, item_size as usize);
            prop_assert_eq!(meta.count, count as usize);
        }

        #[test]
        fn parse_state_rejects_small_item_size(item_size in 0u32..32, count in any::<u32>()) {
            prop_assert!(parse_state_stake_list_meta(&state_bytes([0; 32], item_size, count, 0)).is_err());
        }

        #[test]
        fn records_never_panic_on_arbitrary_data(
            data in vec(any::<u8>(), 0..600),
            item_size in 32usize..120,
            count in prop_oneof![0usize..20, any::<u32>().prop_map(|c| c as usize), Just(usize::MAX)],
        ) {
            let meta = StakeListMeta { account: Pubkey::default(), item_size, count };
            let res = stake_list_records(&data, &meta);
            match res {
                Ok(records) => {
                    prop_assert_eq!(records.len(), count);
                    prop_assert!(data.len() >= STAKE_LIST_HEADER_LEN + count * item_size);
                    prop_assert_eq!(&data[..8], &STAKE_LIST_DISCRIMINATOR[..]);
                }
                Err(_) => {
                    let fits = count
                        .checked_mul(item_size)
                        .and_then(|l| l.checked_add(STAKE_LIST_HEADER_LEN))
                        .is_some_and(|end| end <= data.len());
                    prop_assert!(!fits || data.len() < 8 || data[..8] != STAKE_LIST_DISCRIMINATOR);
                }
            }
            // lookup on arbitrary data must not panic either
            let _ = stake_list_contains(&data, &meta, &Pubkey::new_unique());
        }

        #[test]
        fn contains_matches_live_records_only(
            records in vec(any::<[u8; 32]>(), 1..12),
            live in 0usize..12,
            capacity_extra in 0usize..4,
            item_size in 32usize..90,
            fill in any::<u8>(),
            probe_idx in any::<prop::sample::Index>(),
            foreign in any::<[u8; 32]>(),
        ) {
            let live = live.min(records.len());
            let data = list_bytes(&records, item_size, records.len() + capacity_extra, fill);
            let meta = StakeListMeta { account: Pubkey::default(), item_size, count: live };
            let probe = records[probe_idx.index(records.len())];
            let expected = records[..live].contains(&probe);
            prop_assert_eq!(stake_list_contains(&data, &meta, &Pubkey::new_from_array(probe)).unwrap(), expected);
            let expected_foreign = records[..live].contains(&foreign);
            prop_assert_eq!(stake_list_contains(&data, &meta, &Pubkey::new_from_array(foreign)).unwrap(), expected_foreign);
        }

        #[test]
        fn contains_ignores_record_tail_bytes(
            record in any::<[u8; 32]>(),
            item_size in 33usize..90,
            tail in any::<u8>(),
        ) {
            // only the first 32 bytes of a record are the stake account address
            let mut data = list_bytes(&[record], item_size, 1, tail);
            let meta = StakeListMeta { account: Pubkey::default(), item_size, count: 1 };
            prop_assert!(stake_list_contains(&data, &meta, &Pubkey::new_from_array(record)).unwrap());
            data[STAKE_LIST_HEADER_LEN + 32] ^= 0xff;
            prop_assert!(stake_list_contains(&data, &meta, &Pubkey::new_from_array(record)).unwrap());
        }

        #[test]
        fn wrong_discriminator_is_rejected(
            mut data in vec(any::<u8>(), 8..200),
            disc in any::<[u8; 8]>(),
        ) {
            prop_assume!(disc != STAKE_LIST_DISCRIMINATOR);
            data[..8].copy_from_slice(&disc);
            let meta = StakeListMeta { account: Pubkey::default(), item_size: 32, count: 0 };
            prop_assert!(stake_list_records(&data, &meta).is_err());
        }
    }
}
