use crate::commands::common::CommonCollectOptions;
use crate::utils::rpc::get_rpc_client;
use log::{log, Level};
use serde_yaml;
use std::sync::Arc;
use validator_bonds_common::cli_result::CliError;
use validator_bonds_common::dto::ValidatorBondRecord;
use validator_bonds_common::funded_bonds::collect_validator_bonds_with_funds;

pub async fn collect_bonds(options: CommonCollectOptions) -> anyhow::Result<()> {
    let rpc_client = Arc::new(get_rpc_client(
        options.rpc_url,
        options.commitment.to_string(),
    ));

    let config_address = options.bond_type.config_address();
    log!(
        Level::Info,
        "Collecting bonds '{}', config: {}",
        options.bond_type,
        config_address
    );
    let funded_bonds =
        collect_validator_bonds_with_funds(rpc_client.clone(), config_address).await?;

    let current_epoch_info = rpc_client
        .get_epoch_info()
        .await
        .map_err(CliError::retry_able)?;
    let epoch = current_epoch_info.epoch;
    let updated_at = chrono::Utc::now();

    let mut bonds: Vec<ValidatorBondRecord> = vec![];

    for (pubkey, bond, funds, commissions) in funded_bonds {
        bonds.push(ValidatorBondRecord {
            pubkey: pubkey.to_string(),
            vote_account: bond.vote_account.to_string(),
            authority: bond.authority.to_string(),
            cpmpe: bond.cpmpe.into(),
            max_stake_wanted: bond.max_stake_wanted.into(),
            epoch,
            updated_at,
            funded_amount: funds.funded_amount.into(),
            effective_amount: funds.effective_amount.into(),
            remaining_witdraw_request_amount: funds.remaining_witdraw_request_amount.into(),
            remainining_settlement_claim_amount: funds.remainining_settlement_claim_amount.into(),
            bond_type: options.bond_type.clone(),
            block_commission_bps: commissions.block_bps,
            inflation_commission_bps: commissions.inflation_bps,
            mev_commission_bps: commissions.mev_bps,
            // SAM enrichment is sourced from `bond_event_state` at read time, not collected here.
            auction_stake: None,
            cap_constraint: None,
            required_balance: None,
            deficit: None,
            bond_good_for_n_epochs: None,
            sam_eligible: None,
            bond_tip: None,
            bond_tip_urgency: None,
        })
    }

    serde_yaml::to_writer(std::io::stdout(), &bonds)?;

    Ok(())
}
