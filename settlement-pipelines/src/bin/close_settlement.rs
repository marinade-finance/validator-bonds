use anchor_client::anchor_lang::solana_program::stake::state::StakeStateV2;
use anchor_client::{DynSigner, Program};
use anyhow::anyhow;
use clap::Parser;
use log::{debug, info};
use serde::Serialize;
use settlement_common::utils::read_from_json_file;
use settlement_pipelines::anchor::add_instruction_to_builder;
use settlement_pipelines::arguments::{
    init_from_opts, load_pubkey, GlobalOpts, InitializedGlobalOpts, PriorityFeePolicyOpts,
    ReportOpts, TipPolicyOpts,
};
use settlement_pipelines::cli_result::{CliError, CliResult};
use settlement_pipelines::executor::execute_parallel;
use settlement_pipelines::init::{get_executor, init_log};
use settlement_pipelines::json_data::BondSettlement;
use settlement_pipelines::reporting::{
    with_reporting_ext, PrintReportable, ReportHandler, ReportSerializable,
};
use settlement_pipelines::settlements::{
    load_expired_settlements, obtain_settlement_closing_refunds, SettlementRefundPubkeys,
};
use settlement_pipelines::stake_accounts::{
    filter_settlement_funded, IGNORE_DANGLING_NOT_CLOSABLE_STAKE_ACCOUNTS_LIST,
    STAKE_ACCOUNT_RENT_EXEMPTION,
};
use solana_cli_output::display::build_balance_message;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;
use solana_sdk::stake::config::ID as stake_config_id;
use solana_sdk::stake::program::ID as stake_program_id;
use solana_sdk::sysvar::{
    clock::ID as clock_sysvar_id, stake_history::ID as stake_history_sysvar_id,
};
use solana_transaction_builder::TransactionBuilder;
use solana_transaction_executor::{PriorityFeePolicy, TransactionExecutor};
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use validator_bonds::state::bond::Bond;
use validator_bonds::state::config::{find_bonds_withdrawer_authority, Config};
use validator_bonds::state::settlement::{
    find_settlement_claims_address, find_settlement_staker_authority, Settlement,
};
use validator_bonds::ID as validator_bonds_id;
use validator_bonds_common::bonds::get_bonds_for_pubkeys;
use validator_bonds_common::config::get_config;
use validator_bonds_common::constants::find_event_authority;
use validator_bonds_common::settlements::get_settlements;
use validator_bonds_common::stake_accounts::{collect_stake_accounts, get_clock};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[clap(flatten)]
    global_opts: GlobalOpts,

    #[clap(flatten)]
    priority_fee_policy_opts: PriorityFeePolicyOpts,

    #[clap(flatten)]
    tip_policy_opts: TipPolicyOpts,

    /// Marinade wallet where to return Marinade funded Settlements that were not claimed
    #[clap(long)]
    marinade_wallet: String,

    /// JSON data obtained from the "list-settlement" command
    #[clap(long, short = 'p')]
    listed_settlements: PathBuf,

    #[clap(flatten)]
    report_opts: ReportOpts,
}

#[tokio::main]
async fn main() -> CliResult {
    let args: Args = Args::parse();
    let mut reporting = CloseSettlementReport::report_handler();
    let result = real_main(&mut reporting, &args).await;
    with_reporting_ext::<CloseSettlementReport>(&mut reporting, result, &args.report_opts).await
}

async fn real_main(
    reporting: &mut ReportHandler<CloseSettlementReport>,
    args: &Args,
) -> anyhow::Result<()> {
    init_log(&args.global_opts);

    let InitializedGlobalOpts {
        fee_payer: fee_payer_keypair,
        operator_authority: operator_authority_keypair,
        priority_fee_policy,
        tip_policy,
        rpc_client,
        program,
    } = init_from_opts(
        &args.global_opts,
        &args.priority_fee_policy_opts,
        &args.tip_policy_opts,
    )?;

    let marinade_wallet = load_pubkey(&args.marinade_wallet)
        .map_err(|e| anyhow!("Failed to load --marinade-wallet: {e:?}"))?;

    let config_address = args.global_opts.config.expect("--config is required");
    info!(
        "Closing Settlements and Settlement Claims and Resetting Stake Accounts for validator-bonds config: {config_address}"
    );
    let config = get_config(rpc_client.clone(), config_address)
        .await
        .map_err(CliError::retry_able)?;
    reporting.reportable.init(marinade_wallet, &config);

    let listed_settlements: Vec<BondSettlement> =
        read_from_json_file::<PathBuf, Vec<BondSettlement>>(&args.listed_settlements)
            .map_err(|e| anyhow!("Failed to load --listed-settlements: {e:?}"))?
            .into_iter()
            .filter(|bs| bs.config_address == config_address)
            .collect();

    let mut transaction_builder = TransactionBuilder::limited(fee_payer_keypair.clone());
    let transaction_executor = get_executor(rpc_client.clone(), tip_policy);

    let expired_settlements =
        get_expired_settlements(rpc_client.clone(), &config_address, &config).await?;

    close_settlements(
        &program,
        rpc_client.clone(),
        &mut transaction_builder,
        transaction_executor.clone(),
        &expired_settlements,
        &config_address,
        &priority_fee_policy,
        reporting,
    )
    .await?;

    let mapping_settlements_to_staker_authority = get_settlements(rpc_client.clone())
        .await?
        .into_iter()
        // settlement pubkey -> staker authority pubkey
        .map(|(settlement_address, _)| {
            let (settlement_staker_authority,_) = find_settlement_staker_authority(&settlement_address);
            debug!("Existing Settlement: {settlement_address}, staker authority: {settlement_staker_authority}");
            (
                settlement_address,
                settlement_staker_authority,
            )
        })
        .collect::<HashMap<Pubkey, Pubkey>>();

    reset_stake_accounts(
        &program,
        rpc_client.clone(),
        &mut transaction_builder,
        transaction_executor.clone(),
        &mapping_settlements_to_staker_authority,
        expired_settlements,
        &listed_settlements,
        &config_address,
        &operator_authority_keypair,
        &marinade_wallet,
        &priority_fee_policy,
        reporting,
    )
    .await?;

    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn close_settlements(
    program: &Program<Arc<DynSigner>>,
    rpc_client: Arc<RpcClient>,
    transaction_builder: &mut TransactionBuilder,
    transaction_executor: Arc<TransactionExecutor>,
    expired_settlements: &[(Pubkey, Settlement, Option<Bond>)],
    config_address: &Pubkey,
    priority_fee_policy: &PriorityFeePolicy,
    reporting: &mut ReportHandler<CloseSettlementReport>,
) -> anyhow::Result<()> {
    let (bonds_withdrawer_authority, _) = find_bonds_withdrawer_authority(config_address);
    for (settlement_address, settlement, _) in expired_settlements.iter() {
        let (split_rent_collector, split_rent_refund_account) =
            match obtain_settlement_closing_refunds(
                rpc_client.clone(),
                settlement_address,
                settlement,
                &bonds_withdrawer_authority,
            )
            .await
            {
                Ok(SettlementRefundPubkeys {
                    split_rent_collector,
                    split_rent_refund_account,
                }) => (split_rent_collector, split_rent_refund_account),
                Err(e) => {
                    reporting.error().with_err(e).add();
                    continue;
                }
            };

        let req = program
            .request()
            .accounts(validator_bonds::accounts::CloseSettlementV2 {
                config: *config_address,
                bond: settlement.bond,
                settlement: *settlement_address,
                settlement_claims: find_settlement_claims_address(settlement_address).0,
                bonds_withdrawer_authority,
                rent_collector: settlement.rent_collector,
                split_rent_collector,
                split_rent_refund_account,
                clock: clock_sysvar_id,
                stake_program: stake_program_id,
                stake_history: stake_history_sysvar_id,
                program: validator_bonds_id,
                event_authority: find_event_authority().0,
            })
            .args(validator_bonds::instruction::CloseSettlementV2 {});
        add_instruction_to_builder(
            transaction_builder,
            &req,
            format!(
                "Close Settlement {settlement_address}, refunding split rent from stake account {split_rent_refund_account}"
            ),
        )?;
    }

    let execution_result = execute_parallel(
        rpc_client.clone(),
        transaction_executor.clone(),
        transaction_builder,
        priority_fee_policy,
    )
    .await;
    reporting
        .reportable
        .set_closed_settlements(expired_settlements);

    reporting.add_tx_execution_result(execution_result, "CloseSettlements");

    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn reset_stake_accounts(
    program: &Program<Arc<DynSigner>>,
    rpc_client: Arc<RpcClient>,
    transaction_builder: &mut TransactionBuilder,
    transaction_executor: Arc<TransactionExecutor>,
    mapping_settlements_to_staker_authority: &HashMap<Pubkey, Pubkey>,
    expired_settlements: Vec<(Pubkey, Settlement, Option<Bond>)>,
    listed_settlements: &[BondSettlement],
    config_address: &Pubkey,
    operator_authority_keypair: &Arc<Keypair>,
    marinade_wallet: &Pubkey,
    priority_fee_policy: &PriorityFeePolicy,
    reporting: &mut ReportHandler<CloseSettlementReport>,
) -> anyhow::Result<()> {
    let (bonds_withdrawer_authority, _) = find_bonds_withdrawer_authority(config_address);
    // settlements that do not exist on-chain, but they were loaded from JSON files
    // we calculate mapping the settlement pubkey to the staker authority
    let non_existing_settlement_to_staker_authority = get_expired_stake_accounts(
        mapping_settlements_to_staker_authority,
        listed_settlements,
        expired_settlements,
    );
    let staker_authority_to_existing_settlements = mapping_settlements_to_staker_authority
        .iter()
        .map(|(settlement, staker_authority)| (*staker_authority, *settlement))
        .collect::<HashMap<Pubkey, Pubkey>>();
    debug!(
        "Non-existing Settlements staker authorities: {:?}",
        non_existing_settlement_to_staker_authority
            .iter()
            .map(|(k, v)| (k, v.settlement))
            .collect::<Vec<(&Pubkey, Pubkey)>>()
    );
    let clock = get_clock(rpc_client.clone())
        .await
        .map_err(CliError::retry_able)?;
    let all_bonds_stake_accounts =
        collect_stake_accounts(rpc_client.clone(), Some(&bonds_withdrawer_authority), None)
            .await
            .map_err(CliError::retry_able)?;
    let settlement_funded_stake_accounts =
        filter_settlement_funded(all_bonds_stake_accounts, &clock);
    for (stake_pubkey, lamports, stake_state) in settlement_funded_stake_accounts {
        let staker_authority = if let Some(authorized) = stake_state.authorized() {
            authorized.staker
        } else {
            // this should be already filtered out, not correctly funded settlement
            continue;
        };
        // there is a stake account that belongs to a settlement that does not exist on-chain.
        //  However, we know about it as it was loaded from JSON files, these settlements are most probably
        //  those that were not created as the Bond owner did not fund the Bond account (he exited the bidding program)
        let reset_data = if let Some(reset_data) =
            non_existing_settlement_to_staker_authority.get(&staker_authority)
        {
            reset_data
        } else {
            // if the stake account does not belong to a non-existent (but known from JSON) settlement, then it has to belong to an existing settlement
            // if not then we have a dangling stake account that should be reported
            if !staker_authority_to_existing_settlements.contains_key(&staker_authority) {
                // -> not existing settlement for this stake account, and we know nothing is about (maybe for some reason the stake account was not reset in the past)
                if IGNORE_DANGLING_NOT_CLOSABLE_STAKE_ACCOUNTS_LIST
                    .contains(&stake_pubkey.to_string().as_ref())
                {
                    debug!(
                        "Stake account {stake_pubkey} is dangling but it is in the list of known problematic stake accounts, skipping it."
                    );
                } else {
                    reporting.error().with_msg(format!(
                        "Stake account {stake_pubkey} is dangling, not belonging to any Settlement. Manual intervention needed."
                    )).add();
                }
            }
            continue;
        };

        if let StakeStateV2::Initialized(_) = stake_state {
            transaction_builder.add_signer_checked(operator_authority_keypair);
            // Initialized non-delegated can be withdrawn by operator
            let req = program
                .request()
                .accounts(validator_bonds::accounts::WithdrawStake {
                    config: *config_address,
                    operator_authority: operator_authority_keypair.pubkey(),
                    settlement: reset_data.settlement,
                    stake_account: stake_pubkey,
                    bonds_withdrawer_authority,
                    withdraw_to: *marinade_wallet,
                    stake_history: stake_history_sysvar_id,
                    clock: clock_sysvar_id,
                    stake_program: stake_program_id,
                    program: validator_bonds_id,
                    event_authority: find_event_authority().0,
                })
                .args(validator_bonds::instruction::WithdrawStake {});
            add_instruction_to_builder(
                transaction_builder,
                &req,
                format!(
                    "Withdraw un-claimed stake account {stake_pubkey} for settlement {}",
                    reset_data.settlement
                ),
            )?;
            reporting.reportable.add_withdraw_stake(
                reset_data.settlement,
                *marinade_wallet,
                reset_data.epoch,
                lamports,
            );
        } else if let Some(settlement_vote_account) = reset_data.vote_account {
            // Delegated stake account can be reset to a bond
            let req = program
                .request()
                .accounts(validator_bonds::accounts::ResetStake {
                    config: *config_address,
                    bond: reset_data.bond,
                    settlement: reset_data.settlement,
                    stake_account: stake_pubkey,
                    bonds_withdrawer_authority,
                    vote_account: settlement_vote_account,
                    stake_history: stake_history_sysvar_id,
                    stake_config: stake_config_id,
                    clock: clock_sysvar_id,
                    stake_program: stake_program_id,
                    program: validator_bonds_id,
                    event_authority: find_event_authority().0,
                })
                .args(validator_bonds::instruction::ResetStake {});
            add_instruction_to_builder(
                transaction_builder,
                &req,
                format!(
                    "Reset un-claimed stake account {stake_pubkey} for settlement {}",
                    reset_data.settlement
                ),
            )?;
            reporting.reportable.add_reset_stake(
                reset_data.settlement,
                settlement_vote_account,
                reset_data.epoch,
                lamports,
            );
        } else {
            reporting.error().with_msg(format!(
                "To reset stake account {} (bond: {}, staker authority: {}) is required to know vote account address but that was lost. Manual intervention needed.",
                stake_pubkey, reset_data.bond, staker_authority
            )).add();
        }
    }

    let execution_result = execute_parallel(
        rpc_client.clone(),
        transaction_executor.clone(),
        transaction_builder,
        priority_fee_policy,
    )
    .await;
    reporting.add_tx_execution_result(execution_result, "Reset/WithdrawStakeAccounts");

    Ok(())
}

async fn get_expired_settlements(
    rpc_client: Arc<RpcClient>,
    config_address: &Pubkey,
    config: &Config,
) -> Result<Vec<(Pubkey, Settlement, Option<Bond>)>, CliError> {
    let expired_settlements = load_expired_settlements(rpc_client.clone(), config_address, config)
        .await
        .map_err(CliError::RetryAble)?;
    let expired_settlements_bond_pubkeys = expired_settlements
        .iter()
        .map(|(_, settlement)| settlement.bond)
        .collect::<HashSet<Pubkey>>()
        .into_iter()
        .collect::<Vec<Pubkey>>();
    let bonds = get_bonds_for_pubkeys(rpc_client, &expired_settlements_bond_pubkeys)
        .await
        .map_err(CliError::RetryAble)?;
    Ok(expired_settlements
        .into_iter()
        .map(|(pubkey, settlement)| {
            let bond = bonds
                .iter()
                .find(|(bond_pubkey, _)| bond_pubkey == &settlement.bond)
                .map_or_else(|| None, |(_, bond)| bond.clone());
            (pubkey, settlement, bond)
        })
        .collect::<Vec<(Pubkey, Settlement, Option<Bond>)>>())
}

/// Verification of stake account existence that belongs to Settlements that does not exist
/// Returns: Map: staker authority -> (settlement address, bond address, bond address)
fn get_expired_stake_accounts(
    existing_settlements: &HashMap<Pubkey, Pubkey>,
    listed_settlements: &[BondSettlement],
    expired_settlements: Vec<(Pubkey, Settlement, Option<Bond>)>,
) -> HashMap<Pubkey, ResetStakeData> {
    // settlement addresses from argument -> verification what are not existing
    let not_existing_listed_settlements = listed_settlements
        .iter()
        .filter(|data| existing_settlements.get(&data.settlement_address).is_none())
        .collect::<Vec<&BondSettlement>>();
    expired_settlements
        .into_iter()
        .map(|(settlement_address, settlement, bond)| {
            let (bond_config, bond_vote_account) =
                bond.map_or_else(|| (None, None), |b| (Some(b.config), Some(b.vote_account)));
            (
                bond_config,
                settlement_address,
                settlement.epoch_created_for,
                settlement.bond,
                bond_vote_account,
            )
        })
        .chain(not_existing_listed_settlements.into_iter().map(
            |&BondSettlement {
                 config_address,
                 bond_address,
                 settlement_address,
                 vote_account_address,
                 epoch,
                 ..
             }| {
                (
                    Some(config_address),
                    settlement_address,
                    epoch,
                    bond_address,
                    Some(vote_account_address),
                )
            },
        ))
        .map(|(config, settlement, epoch, bond, vote_account)| {
            (
                find_settlement_staker_authority(&settlement).0,
                ResetStakeData {
                    _config: config,
                    vote_account,
                    bond,
                    settlement,
                    epoch,
                },
            )
        })
        // staker authority -> (settlement address, bond address, bond address)
        .collect::<HashMap<Pubkey, ResetStakeData>>()
}

struct ResetStakeData {
    _config: Option<Pubkey>,
    bond: Pubkey,
    vote_account: Option<Pubkey>,
    settlement: Pubkey,
    epoch: u64,
}

struct CloseSettlementReport {
    config: Option<Config>,
    withdraw_wallet: Pubkey,
    /// settlement pubkey, settlement account
    closed_settlements: Vec<(Pubkey, Settlement)>,
    // epoch -> settlement -> (vote account, number of stake accounts that were reset, lamports)
    reset_stake_grouped: HashMap<u64, HashMap<Pubkey, (Pubkey, u64, u64)>>,
    // epoch -> settlement -> (marinade dao wallet, number of stake accounts that were withdrawn, lamports)
    withdrawn_stake_grouped: HashMap<u64, HashMap<Pubkey, (Pubkey, u64, u64)>>,
}

impl PrintReportable for CloseSettlementReport {
    fn get_report(&self) -> Pin<Box<dyn Future<Output = Vec<String>> + '_>> {
        Box::pin(async {
            let config = if let Some(config) = &self.config {
                config
            } else {
                return vec!["No report available, not initialized yet.".to_string()];
            };
            let minimal_stake_account_lamports =
                config.minimum_stake_lamports + STAKE_ACCOUNT_RENT_EXEMPTION;

            let (reset_stake_number, reset_stake_lamports) = self.reset_stake_total();
            let (withdrawn_stake_number, withdrawn_stake_lamports) = self.withdrawn_stake_total();

            let mut report = vec![
                format!(
                    "Total number of closed settlements: {}",
                    self.closed_settlements.len(),
                ),
                format!(
                    "Number of reset stake accounts (returned to validators): {}, sum of reset SOL: {} (with rent: {})",
                    reset_stake_number,
                    build_balance_message(
                        reset_stake_lamports -
                            (reset_stake_number * minimal_stake_account_lamports), false, false
                    ),
                    build_balance_message(reset_stake_lamports, false, false),
                ),
                format!(
                    "Number of withdraw stake accounts (returned to Marinade DAO {}): {}, sum of withdrawn SOL: {} (with rent: {})",
                    self.withdraw_wallet,
                    withdrawn_stake_number,
                    build_balance_message(
                        withdrawn_stake_lamports -
                            (withdrawn_stake_number * minimal_stake_account_lamports), false, false
                    ),
                    build_balance_message(withdrawn_stake_lamports, false, false),
                ),
            ];
            let settlement_grouped_by_epoch = self
                .closed_settlements
                .iter()
                .map(|(pubkey, s)| (pubkey, s.epoch_created_for))
                .fold(HashMap::new(), |mut acc, (pubkey, epoch)| {
                    let pubkeys: &mut Vec<Pubkey> = acc.entry(epoch).or_default();
                    pubkeys.push(*pubkey);
                    acc
                });
            let mut all_epochs = settlement_grouped_by_epoch
                .keys()
                .chain(self.reset_stake_grouped.keys())
                .chain(self.withdrawn_stake_grouped.keys())
                .cloned()
                .collect::<HashSet<u64>>()
                .into_iter()
                .collect::<Vec<u64>>();
            all_epochs.sort();
            for epoch in all_epochs {
                let settlements = settlement_grouped_by_epoch
                    .get(&epoch)
                    .map_or_else(|| 0, |v| v.len());
                let reset = self
                    .reset_stake_grouped
                    .get(&epoch)
                    .map_or_else(HashMap::new, |v| v.clone());
                let withdrawn = self
                    .withdrawn_stake_grouped
                    .get(&epoch)
                    .map_or_else(HashMap::new, |v| v.clone());
                let reset_per_epoch = Self::total_number_and_lamports_single(&reset);
                let withdrawn_per_epoch = Self::total_number_and_lamports_single(&withdrawn);
                let report_string = format!(
                    "Epoch: {}, closed settlements: {}, reset stake accounts: [#{},{} SOLs], withdraw stake accounts: [#{}, {} SOLs]",
                    epoch,
                    settlements,
                    reset_per_epoch.0,
                    build_balance_message(reset_per_epoch.1, false, false),
                    withdrawn_per_epoch.0,
                    build_balance_message(withdrawn_per_epoch.1, false, false)
                );
                report.push(report_string);
                for (settlement, vote_account, num, lamports) in Self::flat_settlement_map(&reset) {
                    report.push(format!(
                        "  Reset stake account for settlement {} (vote account: {}): {}, {} SOLs",
                        settlement,
                        vote_account,
                        num,
                        build_balance_message(lamports, false, false)
                    ));
                }
                for (settlement, wallet, num, lamports) in Self::flat_settlement_map(&withdrawn) {
                    report.push(format!(
                        "  Withdraw stake account for settlement {} (wallet: {}): {}, {} SOLs",
                        settlement,
                        wallet,
                        num,
                        build_balance_message(lamports, false, false)
                    ));
                }
            }
            report
        })
    }
}

impl CloseSettlementReport {
    fn report_handler() -> ReportHandler<Self> {
        let reportable = Self {
            config: None,
            withdraw_wallet: Pubkey::default(),
            closed_settlements: vec![],
            reset_stake_grouped: HashMap::new(),
            withdrawn_stake_grouped: HashMap::new(),
        };
        ReportHandler::new(reportable)
    }

    fn init(&mut self, withdraw_wallet: Pubkey, config: &Config) {
        self.config = Some(config.clone());
        self.withdraw_wallet = withdraw_wallet;
    }

    fn set_closed_settlements(&mut self, settlements: &[(Pubkey, Settlement, Option<Bond>)]) {
        self.closed_settlements = settlements
            .iter()
            .map(|(p, s, _)| (*p, s.clone()))
            .collect::<Vec<(Pubkey, Settlement)>>();
    }

    fn add_reset_stake(
        &mut self,
        settlement: Pubkey,
        vote_account: Pubkey,
        settlement_epoch: u64,
        lamports: u64,
    ) {
        let record = self
            .reset_stake_grouped
            .entry(settlement_epoch)
            .or_default();
        let data = record
            .entry(settlement)
            .or_insert((vote_account, 0_u64, 0_u64));
        *data = (data.0, data.1 + 1, data.2 + lamports);
    }

    fn add_withdraw_stake(
        &mut self,
        settlement: Pubkey,
        wallet: Pubkey,
        settlement_epoch: u64,
        lamports: u64,
    ) {
        let record = self
            .withdrawn_stake_grouped
            .entry(settlement_epoch)
            .or_default();
        let data = record.entry(settlement).or_insert((wallet, 0_u64, 0_u64));
        *data = (data.0, data.1 + 1, data.2 + lamports);
    }

    fn reset_stake_total(&self) -> (u64, u64) {
        Self::total_number_and_lamports(&self.reset_stake_grouped)
    }

    fn withdrawn_stake_total(&self) -> (u64, u64) {
        Self::total_number_and_lamports(&self.withdrawn_stake_grouped)
    }

    fn total_number_and_lamports(
        map: &HashMap<u64, HashMap<Pubkey, (Pubkey, u64, u64)>>,
    ) -> (u64, u64) {
        map.values()
            .flat_map(|v| v.values())
            .fold((0_u64, 0_u64), |acc, (_, num, lamports)| {
                (acc.0 + num, acc.1 + lamports)
            })
    }

    fn total_number_and_lamports_single(map: &HashMap<Pubkey, (Pubkey, u64, u64)>) -> (u64, u64) {
        map.values()
            .fold((0_u64, 0_u64), |acc, (_, num, lamports)| {
                (acc.0 + num, acc.1 + lamports)
            })
    }

    fn flat_settlement_map(
        map: &HashMap<Pubkey, (Pubkey, u64, u64)>,
    ) -> Vec<(Pubkey, Pubkey, u64, u64)> {
        map.iter()
            .map(|(settlement, (wallet, num, lamports))| (*settlement, *wallet, *num, *lamports))
            .collect::<Vec<(Pubkey, Pubkey, u64, u64)>>()
    }
}

#[derive(Debug, Clone, Serialize)]
struct CloseSettlementJsonSummary {
    closed_settlements: u64,
    reset_stake_accounts: u64,
    reset_stake_sol: f64,
    withdrawn_stake_accounts: u64,
    withdrawn_stake_sol: f64,
}

impl ReportSerializable for CloseSettlementReport {
    fn command_name(&self) -> &'static str {
        "close-settlement"
    }

    fn get_json_summary(&self) -> Pin<Box<dyn Future<Output = serde_json::Value> + '_>> {
        Box::pin(async {
            let lamports_to_sol = |lamports: u64| -> f64 { lamports as f64 / 1_000_000_000.0 };
            let (reset_stake_accounts, reset_stake_lamports) = self.reset_stake_total();
            let (withdrawn_stake_accounts, withdrawn_stake_lamports) = self.withdrawn_stake_total();

            let summary = CloseSettlementJsonSummary {
                closed_settlements: self.closed_settlements.len() as u64,
                reset_stake_accounts,
                reset_stake_sol: lamports_to_sol(reset_stake_lamports),
                withdrawn_stake_accounts,
                withdrawn_stake_sol: lamports_to_sol(withdrawn_stake_lamports),
            };

            serde_json::to_value(summary)
                .unwrap_or_else(|e| serde_json::json!({"error": e.to_string()}))
        })
    }
}
