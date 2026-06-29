use anyhow::anyhow;
use clap::Parser;
use log::{error, info};
use merkle_tree::serde_serialize::{option_pubkey_string_conversion, pubkey_string_conversion};
use serde::{Deserialize, Serialize};
use settlement_common::utils::read_from_json_file;
use settlement_pipelines::arguments::{get_rpc_client, GlobalOpts, ReportOpts};
use settlement_pipelines::init::init_log;
use settlement_pipelines::json_data::BondSettlement;
use settlement_pipelines::reporting::{
    with_reporting_ext, PrintReportable, ReportHandler, ReportSerializable,
};
use settlement_pipelines::stake_accounts::{
    settlement_funded_claimable_lamports, STAKE_ACCOUNT_RENT_EXEMPTION,
};
use solana_sdk::pubkey::Pubkey;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::ops::Range;
use std::path::PathBuf;
use std::pin::Pin;
use validator_bonds::state::config::find_bonds_withdrawer_authority;
use validator_bonds::state::settlement::{find_settlement_staker_authority, Settlement};
use validator_bonds_common::cli_result::{CliError, CliResult};
use validator_bonds_common::config::get_config;
use validator_bonds_common::settlements::get_settlements_for_config;
use validator_bonds_common::stake_accounts::{collect_stake_accounts, CollectedStakeAccounts};

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
    #[serde(with = "option_pubkey_string_conversion")]
    vote_account: Option<Pubkey>,
    #[serde(with = "option_pubkey_string_conversion")]
    bond: Option<Pubkey>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    claims_lamports: Option<u64>,
}

impl SettlementEpoch {
    fn new(
        epoch: u64,
        address: Pubkey,
        vote_account: Option<Pubkey>,
        bond: Option<Pubkey>,
    ) -> Self {
        Self {
            epoch,
            address,
            vote_account,
            bond,
            claims_lamports: None,
        }
    }

    fn with_claims_lamports(mut self, claims_lamports: u64) -> Self {
        self.claims_lamports = Some(claims_lamports);
        self
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
                None,
                Some(settlement.bond),
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
    stake_accounts: &CollectedStakeAccounts,
    minimal_stake_lamports: u64,
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
                // A settlement is funded if the on-chain `fund_settlement` instruction has run
                // (ValidatorBond path bumps `lamports_funded`), OR it has already been (partially)
                // claimed (claims are impossible without funding), OR it is funded by stake
                // accounts assigned to its staker authority (the Marinade path, which never bumps
                // `lamports_funded`). Without the latter two conditions every Marinade-funded
                // settlement — even fully funded and fully claimed ones — is falsely reported as
                // non-funded.
                let settlement_staker_authority =
                    find_settlement_staker_authority(&listed_settlement.settlement_address).0;
                let funded_by_stake_accounts = settlement_funded_claimable_lamports(
                    &settlement_staker_authority,
                    stake_accounts,
                    minimal_stake_lamports,
                );
                let is_funded = onchain_settlement.lamports_funded > 0
                    || onchain_settlement.lamports_claimed > 0
                    || onchain_settlement.lamports_claimed + funded_by_stake_accounts
                        >= onchain_settlement.max_total_claim;
                if !is_funded {
                    error!(
                        "Existing JSON settlement {} emitted on-chain but not funded (epoch: {})",
                        listed_settlement.settlement_address, epoch_to_verify
                    );
                    non_funded_settlements.push(
                        SettlementEpoch::new(
                            epoch_to_verify,
                            listed_settlement.settlement_address,
                            Some(listed_settlement.vote_account_address),
                            Some(listed_settlement.bond_address),
                        )
                        .with_claims_lamports(listed_settlement.claims_lamports),
                    );
                }
            } else {
                error!(
                    "Existing JSON settlement {} not found on-chain (epoch: {})",
                    listed_settlement.settlement_address, epoch_to_verify
                );
                non_existing_settlements.push(SettlementEpoch::new(
                    epoch_to_verify,
                    listed_settlement.settlement_address,
                    Some(listed_settlement.vote_account_address),
                    Some(listed_settlement.bond_address),
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
        .map_err(CliError::critical)?;

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

    let (rpc_client, _) = get_rpc_client(&args.global_opts).map_err(CliError::retry_able)?;

    let config_data = get_config(rpc_client.clone(), config_address)
        .await
        .map_err(CliError::retry_able)?;

    let current_epoch = rpc_client
        .get_epoch_info()
        .await
        .map_err(CliError::retry_able)?
        .epoch;

    let claiming_start_epoch = current_epoch.saturating_sub(config_data.epochs_to_claim_settlement);
    // expecting we do not have created settlements for the current epoch and maybe not yet created for previous epoch
    // but for any other past claimable epochs we need settlements to exist
    let claiming_epoch_range = claiming_start_epoch..(current_epoch - 1);

    let onchain_settlements: HashMap<Pubkey, Settlement> =
        get_settlements_for_config(rpc_client.clone(), &config_address)
            .await?
            .into_iter()
            .collect();

    // Marinade-funded settlements never bump `Settlement.lamports_funded`, so funding for them can
    // only be detected from the bonds-owned stake accounts assigned to each settlement's staker
    // authority (mirrors how fund-settlement and close-settlement load stake accounts).
    let (bonds_withdrawer_authority, _) = find_bonds_withdrawer_authority(&config_address);
    let stake_accounts =
        collect_stake_accounts(rpc_client.clone(), Some(&bonds_withdrawer_authority), None)
            .await
            .map_err(CliError::retry_able)?;
    let minimal_stake_lamports = config_data.minimum_stake_lamports + STAKE_ACCOUNT_RENT_EXEMPTION;

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
                &stake_accounts,
                minimal_stake_lamports,
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

#[cfg(test)]
mod tests {
    use super::*;
    use solana_sdk::stake::state::{Authorized, Lockup, Meta, StakeStateV2};

    const SOL: u64 = 1_000_000_000;
    const MIN: u64 = SOL + STAKE_ACCOUNT_RENT_EXEMPTION;

    fn make_settlement(
        max_total_claim: u64,
        lamports_funded: u64,
        lamports_claimed: u64,
    ) -> Settlement {
        Settlement {
            bond: Pubkey::default(),
            staker_authority: Pubkey::default(),
            merkle_root: [0u8; 32],
            max_total_claim,
            max_merkle_nodes: 1,
            lamports_funded,
            lamports_claimed,
            merkle_nodes_claimed: 0,
            epoch_created_for: 0,
            slot_created_at: 0,
            rent_collector: Pubkey::default(),
            split_rent_collector: None,
            split_rent_amount: 0,
            bumps: Default::default(),
            reserved: [0u8; 90],
        }
    }

    fn bond_settlement(
        settlement_address: Pubkey,
        epoch: u64,
        claims_lamports: u64,
    ) -> BondSettlement {
        BondSettlement {
            config_address: Pubkey::default(),
            bond_address: Pubkey::new_unique(),
            vote_account_address: Pubkey::new_unique(),
            settlement_address,
            epoch,
            merkle_root: [0u8; 32],
            claims_count: 1,
            claims_lamports,
        }
    }

    fn stake_funded_to(staker: Pubkey, lamports: u64) -> (Pubkey, u64, StakeStateV2) {
        (
            Pubkey::new_unique(),
            lamports,
            StakeStateV2::Initialized(Meta {
                rent_exempt_reserve: STAKE_ACCOUNT_RENT_EXEMPTION,
                authorized: Authorized {
                    staker,
                    withdrawer: Pubkey::new_unique(),
                },
                lockup: Lockup::default(),
            }),
        )
    }

    // Regression for the ep992/ep993 incident: Marinade-funded settlements have
    // `lamports_funded == 0` even when funded, so they must not be flagged as non-funded when they
    // are either already claimed or backed by a funding stake account.
    #[test]
    fn marinade_funded_settlements_are_not_flagged() {
        let epoch = 992u64;
        // A: claimed Marinade settlement (funded=0 but claimed>0) — like EkdR5SQ..
        let a_addr = Pubkey::new_unique();
        // B: funded-but-unclaimed Marinade settlement (funded=0, claimed=0, stake account holds it)
        //    — like ep993 BUJVBJD..
        let b_addr = Pubkey::new_unique();
        // C: genuinely unfunded dust settlement (no funding, no claims, no stake account)
        let c_addr = Pubkey::new_unique();

        let onchain: HashMap<Pubkey, Settlement> = HashMap::from([
            (a_addr, make_settlement(15 * SOL, 0, 15 * SOL)),
            (b_addr, make_settlement(11 * SOL, 0, 0)),
            (c_addr, make_settlement(SOL / 4, 0, 0)),
        ]);

        // Only B is backed by a stake account assigned to its settlement staker authority.
        let b_staker = find_settlement_staker_authority(&b_addr).0;
        let stake_accounts: CollectedStakeAccounts =
            vec![stake_funded_to(b_staker, 11 * SOL + MIN)];

        let listed = vec![
            bond_settlement(a_addr, epoch, 15 * SOL),
            bond_settlement(b_addr, epoch, 11 * SOL),
            bond_settlement(c_addr, epoch, SOL / 4),
        ];
        let mut per_epoch: HashMap<u64, Vec<&BondSettlement>> = HashMap::new();
        per_epoch.insert(epoch, listed.iter().collect());

        let (non_verified, non_existing, non_funded) = verify_epoch_settlements(
            epoch..(epoch + 1),
            &per_epoch,
            &onchain,
            &stake_accounts,
            MIN,
        );

        assert!(non_verified.is_empty());
        assert!(non_existing.is_empty());
        let flagged: Vec<Pubkey> = non_funded.iter().map(|s| s.address).collect();
        assert_eq!(
            flagged,
            vec![c_addr],
            "only the genuinely-unfunded dust settlement should be flagged as non-funded"
        );
    }

    #[test]
    fn validator_bond_funded_settlement_is_not_flagged() {
        let epoch = 992u64;
        let addr = Pubkey::new_unique();
        // ValidatorBond funding bumps lamports_funded on-chain.
        let onchain = HashMap::from([(addr, make_settlement(5 * SOL, 5 * SOL, 0))]);
        let listed = vec![bond_settlement(addr, epoch, 5 * SOL)];
        let mut per_epoch: HashMap<u64, Vec<&BondSettlement>> = HashMap::new();
        per_epoch.insert(epoch, listed.iter().collect());
        let empty: CollectedStakeAccounts = vec![];

        let (_, _, non_funded) =
            verify_epoch_settlements(epoch..(epoch + 1), &per_epoch, &onchain, &empty, MIN);
        assert!(non_funded.is_empty());
    }

    #[test]
    fn underfunded_settlement_is_still_flagged() {
        let epoch = 992u64;
        let addr = Pubkey::new_unique();
        // funded=0, claimed=0, and the stake account holds less than max_total_claim -> not funded
        let onchain = HashMap::from([(addr, make_settlement(11 * SOL, 0, 0))]);
        let staker = find_settlement_staker_authority(&addr).0;
        let stake_accounts: CollectedStakeAccounts = vec![stake_funded_to(staker, 4 * SOL + MIN)];
        let listed = vec![bond_settlement(addr, epoch, 11 * SOL)];
        let mut per_epoch: HashMap<u64, Vec<&BondSettlement>> = HashMap::new();
        per_epoch.insert(epoch, listed.iter().collect());

        let (_, _, non_funded) = verify_epoch_settlements(
            epoch..(epoch + 1),
            &per_epoch,
            &onchain,
            &stake_accounts,
            MIN,
        );
        let flagged: Vec<Pubkey> = non_funded.iter().map(|s| s.address).collect();
        assert_eq!(flagged, vec![addr]);
    }
}
