use crate::commands::common::CollectStakeOptions;
use crate::config::load_collector_config;
use crate::utils::rpc::get_rpc_client;
use log::{log, Level};
use serde_yaml;
use std::sync::Arc;
use validator_bonds_common::dto::CollectedStakeRecord;
use validator_bonds_common::stake_accounts::collect_stake_by_authority;

pub async fn collect_stake(options: CollectStakeOptions) -> anyhow::Result<()> {
    let stake_authorities = load_collector_config(&options.config)?;
    let rpc_client = Arc::new(get_rpc_client(
        options.rpc.rpc_url,
        options.rpc.commitment.to_string(),
    ));

    log!(
        Level::Info,
        "Collecting stake of {} authorities: {:?}",
        stake_authorities.len(),
        stake_authorities
            .iter()
            .map(|authority| authority.label.as_str())
            .collect::<Vec<_>>()
    );

    let collected = collect_stake_by_authority(
        rpc_client,
        &stake_authorities
            .iter()
            .map(|authority| authority.stake_authority)
            .collect::<Vec<_>>(),
    )
    .await?;
    let updated_at = chrono::Utc::now();

    let mut records: Vec<CollectedStakeRecord> = vec![];
    for authority in &stake_authorities {
        let per_vote_account = collected
            .authorities
            .get(&authority.stake_authority)
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "Stake of '{}' ({}) was not collected",
                    authority.label,
                    authority.stake_authority
                )
            })?;
        for (vote_account, aggregate) in per_vote_account {
            records.push(CollectedStakeRecord {
                epoch: collected.epoch,
                slot: collected.slot,
                label: authority.label.clone(),
                stake_authority: authority.stake_authority.to_string(),
                vote_account: vote_account.to_string(),
                effective: aggregate.effective,
                activating: aggregate.activating,
                deactivating: aggregate.deactivating,
                stake_accounts: aggregate.stake_accounts,
                updated_at,
            })
        }
    }

    log!(
        Level::Info,
        "Collected {} stake records, epoch {}, slot {}",
        records.len(),
        collected.epoch,
        collected.slot
    );

    serde_yaml::to_writer(std::io::stdout(), &records)?;

    Ok(())
}
