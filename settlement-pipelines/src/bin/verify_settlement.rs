use anyhow::anyhow;
use clap::Parser;
use log::{error, info};
use merkle_tree::serde_serialize::pubkey_string_conversion;
use serde::{Deserialize, Serialize};
use settlement_common::utils::read_from_json_file;
use settlement_pipelines::arguments::{get_rpc_client, GlobalOpts, ReportOpts};
use settlement_pipelines::cli_result::{CliError, CliResult};
use settlement_pipelines::init::init_log;
use settlement_pipelines::json_data::BondSettlement;
use settlement_pipelines::reporting::{
    with_reporting_ext, PrintReportable, ReportHandler, ReportSerializable,
};
use solana_sdk::pubkey::Pubkey;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::ops::Range;
use std::path::PathBuf;
use std::pin::Pin;
use validator_bonds::state::settlement::Settlement;
use validator_bonds_common::config::get_config;
use validator_bonds_common::settlements::get_settlements_for_config;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[clap(flatten)]
    global_opts: GlobalOpts,

    /// JSON data obtained from the "list-settlement" command
    #[clap(long, short = 'p')]
    listed_settlements: PathBuf,

    #[clap(flatten)]
    report_opts: ReportOpts,
}

#[tokio::main]
async fn main() -> CliResult {
    let args: Args = Args::parse();
    let mut reporting = VerifySettlementReport::report_handler();
    let result = real_main(&mut reporting, &args).await;
    with_reporting_ext::<VerifySettlementReport>(&mut reporting, result, &args.report_opts).await
}

#[derive(Default, Debug, Serialize, Deserialize)]
struct SettlementEpoch {
    epoch: u64,
    #[serde(with = "pubkey_string_conversion")]
    address: Pubkey,
}

impl SettlementEpoch {
    fn new(epoch: u64, address: Pubkey) -> Self {
        Self { epoch, address }
    }
}

#[derive(Default, Debug, Serialize, Deserialize)]
struct VerifyAlerts {
    verified_epochs: Vec<u64>,
    unknown_settlements: Vec<SettlementEpoch>,
    non_verified_epochs: Vec<u64>,
    non_existing_settlements: Vec<SettlementEpoch>,
    non_funded_settlements: Vec<SettlementEpoch>,
}

impl VerifyAlerts {
    pub fn new(epochs: &[u64]) -> Self {
        VerifyAlerts {
            verified_epochs: epochs.to_owned(),
            ..Self::default()
        }
    }
    pub fn is_no_alerts(&self) -> bool {
        self.unknown_settlements.is_empty()
            && self.non_verified_epochs.is_empty()
            && self.non_existing_settlements.is_empty()
            && self.non_funded_settlements.is_empty()
    }
}

/// Verify that all on-chain settlements are known in the list
/// Returns unknown settlements - on-chain but not in listed settlements (in gcloud JSON)
fn verify_unknown_settlements(
    onchain_settlements: &HashMap<Pubkey, Settlement>,
    listed_settlements: &[BondSettlement],
) -> Vec<SettlementEpoch> {
    let listed_settlement_addresses: HashSet<Pubkey> = listed_settlements
        .iter()
        .map(|s| s.settlement_address)
        .collect();

    let mut unknown_settlements = Vec::new();
    for (settlement_pubkey, settlement) in onchain_settlements.iter() {
        if !listed_settlement_addresses.contains(settlement_pubkey) {
            unknown_settlements.push(SettlementEpoch::new(
                settlement.epoch_created_for,
                *settlement_pubkey,
            ));
        }
    }

    unknown_settlements
}

/// Verify settlements for epochs within the claiming range
/// Returns alerts for non-verified epochs, non-existing settlements, and non-funded settlements
fn verify_epoch_settlements(
    claiming_epoch_range: Range<u64>,
    listed_settlements_per_epoch: &HashMap<u64, Vec<&BondSettlement>>,
    onchain_settlements: &HashMap<Pubkey, Settlement>,
) -> (Vec<u64>, Vec<SettlementEpoch>, Vec<SettlementEpoch>) {
    let mut non_verified_epochs = Vec::new();
    let mut non_existing_settlements = Vec::new();
    let mut non_funded_settlements = Vec::new();

    for epoch_to_verify in claiming_epoch_range {
        info!("Verifying settlements for epoch {epoch_to_verify}");
        let epoch_listed_settlements =
            if let Some(settlements) = listed_settlements_per_epoch.get(&epoch_to_verify) {
                settlements
            } else {
                error!("No settlement found for claiming epoch {epoch_to_verify}");
                non_verified_epochs.push(epoch_to_verify);
                continue;
            };

        // When we have stored the settlements in the JSON file, we expect them to be emitted on-chain and funded
        for listed_settlement in epoch_listed_settlements {
            if let Some(onchain_settlement) =
                onchain_settlements.get(&listed_settlement.settlement_address)
            {
                if onchain_settlement.lamports_funded == 0 {
                    error!(
                        "Existing JSON settlement {} emitted on-chain but not funded (epoch: {})",
                        listed_settlement.settlement_address, epoch_to_verify
                    );
                    non_funded_settlements.push(SettlementEpoch::new(
                        epoch_to_verify,
                        listed_settlement.settlement_address,
                    ));
                }
            } else {
                error!(
                    "Existing JSON settlement {} not found on-chain (epoch: {})",
                    listed_settlement.settlement_address, epoch_to_verify
                );
                non_existing_settlements.push(SettlementEpoch::new(
                    epoch_to_verify,
                    listed_settlement.settlement_address,
                ));
            }
        }
    }

    (
        non_verified_epochs,
        non_existing_settlements,
        non_funded_settlements,
    )
}

async fn real_main(
    reporting: &mut ReportHandler<VerifySettlementReport>,
    args: &Args,
) -> anyhow::Result<()> {
    init_log(&args.global_opts);

    let config_address = args.global_opts.config.expect("--config is required");
    info!(
        "Verify existing settlements from list of settlements JSON file {:?} for validator-bonds config: {}",
        args.listed_settlements, config_address
    );

    // Load JSON settlements
    let listed_settlements: Vec<BondSettlement> = read_from_json_file(&args.listed_settlements)
        .map_err(|e| anyhow!("Failed to load --listed-settlements: {e:?}"))
        .map_err(CliError::Critical)?;

    info!(
        "Loaded {} settlements from --listed-settlements file",
        listed_settlements.len()
    );

    let listed_settlements_per_epoch: HashMap<u64, Vec<&BondSettlement>> = listed_settlements
        .iter()
        .fold(HashMap::new(), |mut acc, s| {
            acc.entry(s.epoch).or_default().push(s);
            acc
        });

    let (rpc_client, _) = get_rpc_client(&args.global_opts).map_err(CliError::RetryAble)?;

    let config_data = get_config(rpc_client.clone(), config_address)
        .await
        .map_err(CliError::RetryAble)?;

    let current_epoch = rpc_client
        .get_epoch_info()
        .await
        .map_err(|e| CliError::retry_able(&e))?
        .epoch;

    let claiming_start_epoch = current_epoch.saturating_sub(config_data.epochs_to_claim_settlement);
    // expecting we do not have created settlements for the current epoch and maybe not yet created for previous epoch
    // but for any other past claimable epochs we need settlements to exist
    let claiming_epoch_range = claiming_start_epoch..(current_epoch - 1);

    let onchain_settlements: HashMap<Pubkey, Settlement> =
        get_settlements_for_config(rpc_client.clone(), &config_address)
            .await
            .map_err(CliError::RetryAble)?
            .into_iter()
            .collect();

    let epochs: Vec<_> = claiming_epoch_range.clone().collect();
    info!(
        "Found {} on-chain settlements for config {} (verifying epochs {:?})",
        onchain_settlements.len(),
        config_address,
        epochs,
    );

    let mut alerts = VerifyAlerts::new(&epochs);

    {
        alerts.unknown_settlements =
            verify_unknown_settlements(&onchain_settlements, &listed_settlements);
    }

    {
        let (non_verified_epochs, non_existing_settlements, non_funded_settlements) =
            verify_epoch_settlements(
                claiming_epoch_range,
                &listed_settlements_per_epoch,
                &onchain_settlements,
            );
        alerts.non_verified_epochs = non_verified_epochs;
        alerts.non_existing_settlements = non_existing_settlements;
        alerts.non_funded_settlements = non_funded_settlements;
    }

    // Report results
    if alerts.is_no_alerts() {
        info!("[OK] All settlements verified");
    } else {
        error!("[ERROR] Settlements verification failed.");
        error!("Alerts:\n {alerts:?}");
        error!(
            "JSON known settlements:\n {:?}",
            listed_settlements
                .iter()
                .map(|s| (s.epoch, s.settlement_address))
                .collect::<Vec<(u64, Pubkey)>>()
        );
    }

    reporting.reportable.alerts = Some(alerts);

    Ok(())
}

struct VerifySettlementReport {
    alerts: Option<VerifyAlerts>,
}

impl VerifySettlementReport {
    fn report_handler() -> ReportHandler<Self> {
        ReportHandler::new(Self { alerts: None })
    }
}

impl PrintReportable for VerifySettlementReport {
    fn get_report(&self) -> Pin<Box<dyn Future<Output = Vec<String>> + '_>> {
        Box::pin(async {
            let Some(alerts) = &self.alerts else {
                return vec!["No report available, not initialized yet.".to_string()];
            };
            vec![
                format!("Verified epochs: {:?}", alerts.verified_epochs),
                format!("Unknown settlements: {}", alerts.unknown_settlements.len()),
                format!("Non-verified epochs: {:?}", alerts.non_verified_epochs),
                format!(
                    "Non-existing settlements: {}",
                    alerts.non_existing_settlements.len()
                ),
                format!(
                    "Non-funded settlements: {}",
                    alerts.non_funded_settlements.len()
                ),
            ]
        })
    }
}

impl ReportSerializable for VerifySettlementReport {
    fn command_name(&self) -> &'static str {
        "verify-settlement"
    }

    fn get_json_summary(&self) -> Pin<Box<dyn Future<Output = serde_json::Value> + '_>> {
        Box::pin(async {
            match &self.alerts {
                Some(alerts) => serde_json::to_value(alerts)
                    .unwrap_or_else(|e| serde_json::json!({"error": e.to_string()})),
                None => serde_json::json!({"error": "not initialized"}),
            }
        })
    }
}
