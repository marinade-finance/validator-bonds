use anchor_client::anchor_lang::prelude::StakeHistory;

use anchor_client::anchor_lang::solana_program::stake::state::StakeStateV2;

use anchor_client::{DynSigner, Program};
use clap::Parser;
use log::{debug, info};

use settlement_pipelines::arguments::GlobalOpts;
use settlement_pipelines::arguments::{
    init_from_opts, InitializedGlobalOpts, PriorityFeePolicyOpts, TipPolicyOpts,
};
use settlement_pipelines::cli_result::{CliError, CliResult};
use settlement_pipelines::executor::execute_parallel_with_rate;
use settlement_pipelines::init::{get_executor, init_log};

use settlement_pipelines::reporting::{with_reporting, PrintReportable, ReportHandler};

use settlement_pipelines::stake_accounts::{
    get_stake_state_type, prepare_merge_instructions, StakeAccountStateType,
};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::clock::Clock;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Keypair;

use solana_transaction_builder::TransactionBuilder;
use solana_transaction_executor::{PriorityFeePolicy, TransactionExecutor};
use std::cmp::Reverse;
use std::collections::HashMap;
use std::future::Future;

use solana_sdk::stake::state::Stake;
use std::pin::Pin;
use std::sync::Arc;
use validator_bonds::state::config::find_bonds_withdrawer_authority;

use validator_bonds_common::config::get_config;

use validator_bonds_common::stake_accounts::{
    collect_stake_accounts, get_clock, get_stake_history, CollectedStakeAccount,
};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[clap(flatten)]
    global_opts: GlobalOpts,

    #[clap(flatten)]
    priority_fee_policy_opts: PriorityFeePolicyOpts,

    #[clap(flatten)]
    tip_policy_opts: TipPolicyOpts,
}

#[tokio::main]
async fn main() -> CliResult {
    let mut reporting = MergeConfigReport::report_handler();
    let result = real_main(&mut reporting).await;
    with_reporting::<MergeConfigReport>(&mut reporting, result).await
}

async fn real_main(reporting: &mut ReportHandler<MergeConfigReport>) -> anyhow::Result<()> {
    let args: Args = Args::parse();
    init_log(&args.global_opts);

    let InitializedGlobalOpts {
        fee_payer,
        operator_authority: _,
        priority_fee_policy,
        tip_policy,
        rpc_client,
        program,
    } = init_from_opts(
        &args.global_opts,
        &args.priority_fee_policy_opts,
        &args.tip_policy_opts,
    )?;

    let config_address = args.global_opts.config;
    info!(
        "Merging stake accounts of validator-bonds config: {}",
        config_address
    );

    let _config = get_config(rpc_client.clone(), config_address)
        .await
        .map_err(CliError::retry_able)?;

    let transaction_executor = get_executor(rpc_client.clone(), tip_policy);

    reporting.reportable.init(&config_address).await;

    let clock = get_clock(rpc_client.clone())
        .await
        .map_err(CliError::retry_able)?;
    let stake_history = get_stake_history(rpc_client.clone())
        .await
        .map_err(CliError::retry_able)?;

    let loaded_stake = get_merge_stake_accounts(
        rpc_client.clone(),
        &config_address,
        &clock,
        &stake_history,
        reporting,
    )
    .await?;

    merge_stake(
        &program,
        rpc_client.clone(),
        transaction_executor.clone(),
        &loaded_stake,
        &config_address,
        fee_payer.clone(),
        &priority_fee_policy,
        &clock,
        &stake_history,
        reporting,
    )
    .await?;

    Ok(())
}

type GetMergeType =
    HashMap<(Pubkey, StakeAccountStateType), Vec<(CollectedStakeAccount, StakeAccountStateType)>>;

/// transient stake cannot be merged, MergeTransientStake (0x5)
/// https://github.com/solana-program/stake/blob/a4ab3b6f82608b430d6f432ccadaeb6af52dac34/program/src/helpers/merge.rs#L38-L70
fn is_transient_stake(inner_stake: &Stake, state_type: StakeAccountStateType) -> bool {
    (state_type == StakeAccountStateType::DelegatedAndActivating
        || state_type == StakeAccountStateType::DelegatedAndDeactivating)
        && inner_stake.delegation.stake > 0
}

#[allow(clippy::too_many_arguments)]
async fn get_merge_stake_accounts(
    rpc_client: Arc<RpcClient>,
    config_address: &Pubkey,
    clock: &Clock,
    stake_history: &StakeHistory,
    report_handler: &mut ReportHandler<MergeConfigReport>,
) -> anyhow::Result<GetMergeType> {
    let (withdrawer_authority, _) = find_bonds_withdrawer_authority(config_address);
    let mut non_funded_stake_accounts = collect_stake_accounts(
        rpc_client.clone(),
        Some(&withdrawer_authority),
        Some(&withdrawer_authority),
    )
    .await
    .map_err(CliError::retry_able)?;
    let stake_account_number = non_funded_stake_accounts.len();
    non_funded_stake_accounts.sort_by_cached_key(|(_, lamports, _)| Reverse(*lamports));
    let mut delegation_stake_accounts: GetMergeType = HashMap::new();
    for stake in non_funded_stake_accounts.into_iter() {
        if let StakeStateV2::Stake(_, inner_stake, _) = stake.2 {
            let state_type = get_stake_state_type(&stake.2, clock, stake_history);
            let key = (inner_stake.delegation.voter_pubkey, state_type);

            if is_transient_stake(&inner_stake, state_type) {
                report_handler.reportable.add_transient(stake.0);
                continue;
            }
            delegation_stake_accounts
                .entry(key)
                .or_default()
                .push((stake, state_type));
        } else {
            report_handler.reportable.add_non_delegated(stake.0);
        }
    }

    info!(
        "Collected {} stake accounts delegated to {} validators owned by withdrawer authority {} (config: {})",
        stake_account_number,
        delegation_stake_accounts.len(),
        withdrawer_authority,
        config_address,
    );
    Ok(delegation_stake_accounts)
}

#[allow(clippy::too_many_arguments)]
async fn merge_stake(
    program: &Program<Arc<DynSigner>>,
    rpc_client: Arc<RpcClient>,
    transaction_executor: Arc<TransactionExecutor>,
    stake_account_records: &GetMergeType,
    config_address: &Pubkey,
    fee_payer: Arc<Keypair>,
    priority_fee_policy: &PriorityFeePolicy,
    clock: &Clock,
    stake_history: &StakeHistory,
    reporting: &mut ReportHandler<MergeConfigReport>,
) -> anyhow::Result<()> {
    let mut transaction_builder = TransactionBuilder::limited(fee_payer.clone());
    let (withdrawer_authority, _) = find_bonds_withdrawer_authority(config_address);

    for ((vote_account, _), merge_stake_accounts) in stake_account_records.iter() {
        if merge_stake_accounts.len() < 2 {
            debug!(
                "Only single stake account found for {:?}, skipping",
                merge_stake_accounts
            );
            continue;
        }
        let destination_stake = &merge_stake_accounts[0].0;
        let destination_stake_state_type = merge_stake_accounts[0].1;
        let possible_to_merge: Vec<&CollectedStakeAccount> = merge_stake_accounts
            .iter()
            .skip(1)
            .map(|(p, _)| p)
            .collect();
        let merging_pubkeys: Vec<Pubkey> = possible_to_merge.iter().map(|p| p.0).collect();
        let non_mergeable = prepare_merge_instructions(
            possible_to_merge,
            destination_stake.0,
            destination_stake_state_type,
            &Pubkey::default(), // not caring about settlements, just not-settled stake accounts
            Some(vote_account),
            program,
            config_address,
            &withdrawer_authority,
            &mut transaction_builder,
            clock,
            stake_history,
        )
        .await?;
        if !non_mergeable.is_empty() {
            return Err(CliError::critical(format!(
                "Not expecting non-mergeable stake accounts here. Config: {}, Stake accounts type: {:?}, accounts: {}",
                config_address,
                destination_stake_state_type,
                non_mergeable.iter().map(|p| p.to_string()).collect::<Vec<String>>().join(", ")
            )));
        }

        reporting
            .reportable
            .merging_stake_accounts
            .push((destination_stake.0, merging_pubkeys));
    }

    let execute_result_merge = execute_parallel_with_rate(
        rpc_client.clone(),
        transaction_executor.clone(),
        &mut transaction_builder,
        priority_fee_policy,
        10,
    )
    .await;
    reporting.add_tx_execution_result(execute_result_merge, "MergeStakeAccounts");

    Ok(())
}

#[derive(Default)]
struct MergeConfigReport {
    config: Pubkey,
    merging_stake_accounts: Vec<(Pubkey, Vec<Pubkey>)>, // (destination, multiple sources)
    non_delegated_stake_accounts: Vec<Pubkey>,
    transient_stake_accounts: Vec<Pubkey>,
}

impl MergeConfigReport {
    fn report_handler() -> ReportHandler<Self> {
        let merge_settlement_report = Self::default();
        ReportHandler::new(merge_settlement_report)
    }

    async fn init(&mut self, config: &Pubkey) {
        self.config = *config;
    }

    fn add_non_delegated(&mut self, stake_account: Pubkey) {
        self.non_delegated_stake_accounts.push(stake_account);
    }

    fn add_transient(&mut self, stake_account: Pubkey) {
        self.transient_stake_accounts.push(stake_account);
    }
}

impl PrintReportable for MergeConfigReport {
    fn get_report(&self) -> Pin<Box<dyn Future<Output = Vec<String>> + '_>> {
        Box::pin(async {
            fn format_accounts<T: ToString>(accounts: &[T]) -> String {
                accounts
                    .iter()
                    .map(|p| p.to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            }

            let mut report = vec![];
            report.push(format!(
                "Merge Report for validator-bonds config: {}. Merged for {} bond(s), {} stake accounts",
                self.config,
                self.merging_stake_accounts.len(),
                self.merging_stake_accounts.iter().map(|(_, sources)| sources.len()).sum::<usize>()
            ));

            if !self.non_delegated_stake_accounts.is_empty() {
                report.push(format!(
                    "Non-delegated stake accounts (cannot be merged): {}",
                    format_accounts(&self.non_delegated_stake_accounts)
                ));
            }
            if !self.transient_stake_accounts.is_empty() {
                report.push(format!(
                    "Transient stake accounts (cannot be merged): {}",
                    format_accounts(&self.transient_stake_accounts)
                ));
            }
            for (destination, sources) in &self.merging_stake_accounts {
                report.push(format!(
                    "Merging to destination {destination}, sources [{}]",
                    format_accounts(sources)
                ));
            }
            report
        })
    }
}
