use solana_program::pubkey::Pubkey;
use {
    log::{error, info},
    merkle_tree::serde_serialize::{option_pubkey_string_conversion, pubkey_string_conversion},
    serde::{Deserialize, Serialize},
    solana_accounts_db::accounts_index::ScanConfig,
    solana_program::{
        native_token::lamports_to_sol,
        stake::state::StakeStateV2,
        stake_history::{Epoch, StakeHistory, StakeHistoryEntry},
    },
    solana_runtime::bank::Bank,
    solana_sdk::{
        account::{Account, AccountSharedData},
        epoch_info::EpochInfo,
    },
    std::{fmt::Debug, sync::Arc},
};

#[derive(Clone, Deserialize, Serialize, Debug, Eq, PartialEq)]
pub struct StakeMeta {
    #[serde(with = "pubkey_string_conversion")]
    pub pubkey: Pubkey,
    pub balance_lamports: u64,
    pub active_delegation_lamports: u64,
    pub activating_delegation_lamports: u64,
    pub deactivating_delegation_lamports: u64,
    #[serde(with = "option_pubkey_string_conversion")]
    pub validator: Option<Pubkey>,
    #[serde(with = "pubkey_string_conversion")]
    pub stake_authority: Pubkey,
    #[serde(with = "pubkey_string_conversion")]
    pub withdraw_authority: Pubkey,
}

impl Ord for StakeMeta {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.pubkey.cmp(&other.pubkey)
    }
}

impl PartialOrd<Self> for StakeMeta {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct StakeMetaCollection {
    pub epoch: Epoch,
    pub slot: u64,
    pub stake_metas: Vec<StakeMeta>,
}

pub fn generate_stake_meta_collection(bank: &Arc<Bank>) -> anyhow::Result<StakeMetaCollection> {
    assert!(bank.is_frozen());

    let EpochInfo {
        epoch,
        absolute_slot,
        ..
    } = bank.get_epoch_info();

    let history_account = <AccountSharedData as Into<Account>>::into(
        bank.get_account(&solana_program::sysvar::stake_history::ID)
            .expect("Failed to fetch the stake history"),
    );
    let history: StakeHistory = bincode::deserialize(&history_account.data)?;
    info!("Stake history loaded.");

    let stake_accounts_raw =
        bank.get_program_accounts(&solana_program::stake::program::ID, &ScanConfig::default())?;
    // let stake_accounts_raw = bank.get_filtered_indexed_accounts(
    //     &solana_accounts_db::accounts_index::IndexKey::ProgramId(
    //         solana_program::stake::program::ID,
    //     ),
    //     |_| true,
    //     &ScanConfig::new(true),
    //     None,
    // )?;
    info!("Stake accounts loaded: {}", stake_accounts_raw.len());

    let mut stake_metas: Vec<StakeMeta> = Default::default();

    for (pubkey, shared_account) in stake_accounts_raw {
        let account = <AccountSharedData as Into<Account>>::into(shared_account);
        let stake_account: StakeStateV2 = match bincode::deserialize(&account.data) {
            Ok(account) => account,
            Err(err) => {
                error!("Error parsing stake account {}: {}", pubkey, err);
                continue;
            }
        };

        let (
            validator,
            active_delegation_lamports,
            activating_delegation_lamports,
            deactivating_delegation_lamports,
        ) = match stake_account.stake() {
            Some(stake) => {
                let StakeHistoryEntry {
                    effective,
                    activating,
                    deactivating,
                } = stake
                    .delegation
                    .stake_activating_and_deactivating(epoch, Some(&history), None);
                (
                    Some(stake.delegation.voter_pubkey),
                    effective,
                    activating,
                    deactivating,
                )
            }
            None => (None, 0, 0, 0),
        };

        stake_metas.push(StakeMeta {
            pubkey,
            balance_lamports: account.lamports,
            active_delegation_lamports,
            activating_delegation_lamports,
            deactivating_delegation_lamports,
            validator,
            stake_authority: stake_account.meta().unwrap_or_default().authorized.staker,
            withdraw_authority: stake_account
                .meta()
                .unwrap_or_default()
                .authorized
                .withdrawer,
        })
    }
    info!("Collected all stake account metas: {}", stake_metas.len());

    let total_active: u64 = stake_metas
        .iter()
        .map(|s| s.active_delegation_lamports)
        .sum();
    let total_activating: u64 = stake_metas
        .iter()
        .map(|s| s.activating_delegation_lamports)
        .sum();
    let total_deactivating: u64 = stake_metas
        .iter()
        .map(|s| s.deactivating_delegation_lamports)
        .sum();

    info!("Total activated stake: {}", lamports_to_sol(total_active));
    info!(
        "Total activating stake: {}",
        lamports_to_sol(total_activating)
    );
    info!(
        "Total deactivating stake: {}",
        lamports_to_sol(total_deactivating)
    );

    stake_metas.sort();
    info!("Sorted stake account metas");

    Ok(StakeMetaCollection {
        epoch,
        slot: absolute_slot,
        stake_metas,
    })
}
