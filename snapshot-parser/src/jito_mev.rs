use solana_accounts_db::accounts_index::ScanConfig;
use solana_program::pubkey::Pubkey;
use solana_sdk::account::{Account, AccountSharedData};

use {log::info, solana_program::stake_history::Epoch, solana_runtime::bank::Bank, std::sync::Arc};

pub struct JitoMevMeta {
    pub vote_account: Pubkey,
    pub mev_commission: u16,
}

// https://github.com/jito-foundation/jito-programs/blob/v0.1.5/mev-programs/programs/tip-distribution/src/state.rs#L32
// only one TipDistribution account per epoch
// https://github.com/jito-foundation/jito-programs/blob/v0.1.5/mev-programs/programs/tip-distribution/src/lib.rs#L385
const JITO_PROGRAM: &str = "4R3gSG8BpU4t19KYj8CfnbtRpnT8gtk4dvTHxVRwc2r7";
const TIP_DISTRIBUTION_ACCOUNT_DISCRIMINATOR: [u8; 8] = [85, 64, 113, 198, 234, 94, 120, 123];
const VALIDATOR_VOTE_ACCOUNT_BYTE_INDEX: usize = 8; // anchor header
const MERKLE_ROOT_OPTION_BYTE_INDEX: usize = 8 + // anchor header
    // TipDistributionAccount "prefix" data
    64;
// epoch at byte index 73
const EPOCH_CREATED_AT_NO_MERKLE_ROOT_BYTE_INDEX: usize =
    // TipDistributionAccount "prefix" + 1 byte for Option<MerkleRoot> when None
    MERKLE_ROOT_OPTION_BYTE_INDEX + 1;
// epoch at byte index 137 (0x89)
const EPOCH_CREATED_AT_WITH_MERKLE_ROOT_BYTE_INDEX: usize =
    // TipDistributionAccount "prefix" + 1 byte for Option
    EPOCH_CREATED_AT_NO_MERKLE_ROOT_BYTE_INDEX +
    // MerkleRoot
    64;
const VALIDATOR_COMMISSION_BPS_BYTE_OFFSET: usize = 8;

pub fn fetch_jito_mev_metas(bank: &Arc<Bank>, epoch: Epoch) -> anyhow::Result<Vec<JitoMevMeta>> {
    let jito_program: Pubkey = JITO_PROGRAM.try_into()?;
    let jito_accounts_raw = bank.get_program_accounts(
        &jito_program,
        &ScanConfig {
            collect_all_unsorted: true,
            ..ScanConfig::default()
        },
    )?;
    info!(
        "jito program {} `raw` accounts loaded: {}",
        JITO_PROGRAM,
        jito_accounts_raw.len()
    );

    let mut jito_mev_metas: Vec<JitoMevMeta> = Vec::new();

    for (pubkey, shared_account) in jito_accounts_raw {
        let account = <AccountSharedData as Into<Account>>::into(shared_account);
        if account.data[0..8] == TIP_DISTRIBUTION_ACCOUNT_DISCRIMINATOR {
            update_jito_mev_metas(&mut jito_mev_metas, &account, pubkey, epoch)?;
        }
    }

    if jito_mev_metas.is_empty() {
        return Err(anyhow::anyhow!(
            "Not expected. No Jito MEV commissions found. Evaluate the snapshot data."
        ));
    }

    info!(
        "jito tip distribution accounts for epoch {}: {}",
        epoch,
        jito_mev_metas.len()
    );
    Ok(jito_mev_metas)
}

fn update_jito_mev_metas(
    jito_mev_metas: &mut Vec<JitoMevMeta>,
    account: &Account,
    pubkey: Pubkey,
    epoch: Epoch,
) -> anyhow::Result<()> {
    let (epoch_created_at, epoch_byte_index) = get_epoch_created_at(account)?;
    if epoch_created_at == epoch {
        update_mev_commission(jito_mev_metas, account, pubkey, epoch_byte_index, epoch)?;
    }
    Ok(())
}

/// Returns the epoch and the byte index where the epoch was found at.
fn get_epoch_created_at(account: &Account) -> anyhow::Result<(u64, usize)> {
    // epoch_created_at_*_byte_index -1 contains info about Option is None (0) or Some (1)
    if u8::from_le_bytes([account.data[MERKLE_ROOT_OPTION_BYTE_INDEX]]) == 0 {
        Ok((
            u64::from_le_bytes(
                account.data[EPOCH_CREATED_AT_NO_MERKLE_ROOT_BYTE_INDEX
                    ..EPOCH_CREATED_AT_NO_MERKLE_ROOT_BYTE_INDEX + 8]
                    .try_into()?,
            ),
            EPOCH_CREATED_AT_NO_MERKLE_ROOT_BYTE_INDEX,
        ))
    } else {
        assert_eq!(
            u8::from_le_bytes([account.data[MERKLE_ROOT_OPTION_BYTE_INDEX]]),
            1
        );
        Ok((
            u64::from_le_bytes(
                account.data[EPOCH_CREATED_AT_WITH_MERKLE_ROOT_BYTE_INDEX
                    ..EPOCH_CREATED_AT_WITH_MERKLE_ROOT_BYTE_INDEX + 8]
                    .try_into()?,
            ),
            EPOCH_CREATED_AT_WITH_MERKLE_ROOT_BYTE_INDEX,
        ))
    }
}

fn update_mev_commission(
    jito_mev_metas: &mut Vec<JitoMevMeta>,
    account: &Account,
    account_pubkey: Pubkey,
    epoch_byte_index: usize,
    epoch: Epoch,
) -> anyhow::Result<()> {
    let (vote_account, jito_commission, epoch_parsed) =
        read_jito_mev_commission(account_pubkey, account, epoch_byte_index)?;
    assert_eq!(epoch, epoch_parsed);
    jito_mev_metas.push(JitoMevMeta {
        vote_account,
        mev_commission: jito_commission,
    });
    Ok(())
}

fn read_jito_mev_commission(
    account_pubkey: Pubkey,
    account: &Account,
    epoch_byte_index: usize,
) -> anyhow::Result<(Pubkey, u16, u64)> {
    let vote_account: Pubkey = account.data
        [VALIDATOR_VOTE_ACCOUNT_BYTE_INDEX..VALIDATOR_VOTE_ACCOUNT_BYTE_INDEX + 32]
        .try_into()
        .map_err(|e| {
            anyhow::anyhow!(
                "Failed to parse on-chain account {}: {:?}",
                account_pubkey,
                e
            )
        })?;

    let epoch: u64 = u64::from_le_bytes(
        account.data[epoch_byte_index..epoch_byte_index + 8]
            .try_into()
            .map_err(|e| {
                anyhow::anyhow!(
                    "Failed to parse epoch for account {}: {:?}",
                    account_pubkey,
                    e
                )
            })?,
    );

    let validator_commission_bps_byte_index =
        epoch_byte_index + VALIDATOR_COMMISSION_BPS_BYTE_OFFSET;
    let mev_commission = u16::from_le_bytes(
        account.data[validator_commission_bps_byte_index..validator_commission_bps_byte_index + 2]
            .try_into()
            .map_err(|e| {
                anyhow::anyhow!(
                "Failed to parse validator_commission_bps (mev commission) for account {}: {:?}",
                account_pubkey,
                e)
            })?,
    );

    Ok((vote_account, mev_commission, epoch))
}
