use anchor_client::{DynSigner, Program};
use anyhow::anyhow;
use clap::Parser;
use log::{debug, error, info};
use settlement_pipelines::anchor::add_instruction_to_builder;
use settlement_pipelines::arguments::{
    init_from_opts, GlobalOpts, InitializedGlobalOpts, PriorityFeePolicyOpts, TipPolicyOpts,
};
use settlement_pipelines::cli_result::{CliError, CliResult};
use settlement_pipelines::executor::{execute_parallel, execute_parallel_with_rate};
use settlement_pipelines::init::{get_executor, init_log};
use settlement_pipelines::json_data::load_json;
use settlement_pipelines::reporting::{with_reporting, PrintReportable, ReportHandler};
use settlement_pipelines::settlement_data::{parse_settlements_from_json, SettlementRecord};
use settlement_pipelines::settlements::{list_claimable_settlements, ClaimableSettlementsReturn};
use settlement_pipelines::stake_accounts::{
    get_stake_state_type, prepare_merge_instructions, prioritize_for_claiming,
    STAKE_ACCOUNT_RENT_EXEMPTION,
};
use settlement_pipelines::stake_accounts_cache::StakeAccountsCache;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::clock::Clock;
use solana_sdk::native_token::lamports_to_sol;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::stake::program::ID as stake_program_id;
use solana_sdk::stake_history::StakeHistory;
use solana_sdk::sysvar::{clock::ID as clock_id, stake_history::ID as stake_history_id};
use solana_transaction_builder::TransactionBuilder;
use solana_transaction_executor::{PriorityFeePolicy, TransactionExecutor};
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use tokio::time::sleep;
use validator_bonds::instructions::ClaimSettlementV2Args;
use validator_bonds::state::config::find_bonds_withdrawer_authority;
use validator_bonds::state::settlement::find_settlement_staker_authority;
use validator_bonds::ID as validator_bonds_id;
use validator_bonds_common::config::get_config;
use validator_bonds_common::constants::find_event_authority;
use validator_bonds_common::settlement_claims::SettlementClaimsBitmap;
use validator_bonds_common::settlements::{
    get_settlement_claims_for_settlement_pubkeys, get_settlements_for_pubkeys,
};
use validator_bonds_common::stake_accounts::{
    collect_stake_accounts, get_clock, get_stake_history, CollectedStakeAccounts,
};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[clap(flatten)]
    global_opts: GlobalOpts,

    /// Pairs of JSON files: 'settlement.json' and 'merkle_tree.json'
    /// There could be provided multiple pairs of JSON files (argument '-f' can be provided multiple times),
    /// while the program expects that one pair contains settlement and merkle tree data of the same event.
    #[arg(required = true, short = 'f', value_delimiter = ' ', num_args(2))]
    json_files: Vec<PathBuf>,

    /// forcing epoch, overriding ones loaded from json files of settlement_json_files
    /// mostly useful for testing purposes
    #[arg(long)]
    epoch: Option<u64>,

    #[clap(flatten)]
    priority_fee_policy_opts: PriorityFeePolicyOpts,

    #[clap(flatten)]
    tip_policy_opts: TipPolicyOpts,
}

#[tokio::main]
async fn main() -> CliResult {
    let mut reporting = ClaimSettlementReport::report_handler();
    let result = real_main(&mut reporting).await;
    with_reporting::<ClaimSettlementReport>(&reporting, result).await
}
async fn real_main(reporting: &mut ReportHandler<ClaimSettlementReport>) -> anyhow::Result<()> {
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
        "Claiming settlements for validator-bonds config: {}",
        config_address
    );
    let config = get_config(rpc_client.clone(), config_address)
        .await
        .map_err(CliError::retry_able)?;

    let mut json_data = load_json(&args.json_files)?;

    let minimal_stake_lamports = config.minimum_stake_lamports + STAKE_ACCOUNT_RENT_EXEMPTION;

    let settlement_records =
        parse_settlements_from_json(&mut json_data, &config_address, args.epoch)
            .map_err(CliError::processing)?;

    // loaded from RPC on-chain data
    let mut claimable_settlements =
        list_claimable_settlements(rpc_client.clone(), &config_address, &config).await?;

    reporting
        .reportable
        .init(rpc_client.clone(), &claimable_settlements);

    let mut transaction_builder = TransactionBuilder::limited(fee_payer.clone());
    let transaction_executor = get_executor(rpc_client.clone(), tip_policy);

    let clock = get_clock(rpc_client.clone())
        .await
        .map_err(CliError::retry_able)?;
    let stake_history = get_stake_history(rpc_client.clone())
        .await
        .map_err(CliError::retry_able)?;

    merge_stake_accounts(
        &mut claimable_settlements,
        &program,
        &config_address,
        &mut transaction_builder,
        &clock,
        &stake_history,
        rpc_client.clone(),
        transaction_executor.clone(),
        &priority_fee_policy,
        reporting,
    )
    .await?;

    let mut settlement_claimed_amounts: HashMap<Pubkey, u64> = HashMap::new();
    let mut stake_accounts_to_cache = StakeAccountsCache::default();

    for claimable_settlement in claimable_settlements {
        let json_matching_settlement =
            match get_settlement_from_json(&settlement_records, &claimable_settlement) {
                Ok(json_record) => json_record,
                Err(e) => {
                    reporting.add_cli_error(e);
                    continue;
                }
            };

        info!(
            "Claiming settlement {}, vote account {}, claim amount {}, for epoch {}, number of FROM stake accounts {}, already claimed merkle tree nodes {}",
            claimable_settlement.settlement_address,
            json_matching_settlement.vote_account_address,
            lamports_to_sol(json_matching_settlement.max_total_claim_sum),
            claimable_settlement.settlement.epoch_created_for,
            claimable_settlement.stake_accounts.len(),
            claimable_settlement.settlement_claims.number_of_set_bits(),
        );

        claim_settlement(
            &program,
            rpc_client.clone(),
            &mut transaction_builder,
            transaction_executor.clone(),
            claimable_settlement,
            json_matching_settlement,
            &config_address,
            &priority_fee_policy,
            reporting,
            &mut settlement_claimed_amounts,
            &mut stake_accounts_to_cache,
            minimal_stake_lamports,
            &clock,
            &stake_history,
        )
        .await?;
    }

    Ok(())
}

/// process merging stake accounts (that is to be claimed) if possible
#[allow(clippy::too_many_arguments)]
async fn merge_stake_accounts(
    claimable_settlements: &mut [ClaimableSettlementsReturn],
    program: &Program<Arc<DynSigner>>,
    config_address: &Pubkey,
    transaction_builder: &mut TransactionBuilder,
    clock: &Clock,
    stake_history: &StakeHistory,
    rpc_client: Arc<RpcClient>,
    transaction_executor: Arc<TransactionExecutor>,
    priority_fee_policy: &PriorityFeePolicy,
    reporting: &mut ReportHandler<ClaimSettlementReport>,
) -> anyhow::Result<()> {
    let mut settlements_with_merge_operation: HashSet<Pubkey> = HashSet::new();
    for claimable_settlement in claimable_settlements.iter() {
        let mergeable_stake_accounts = if claimable_settlement.stake_accounts.len() > 1 {
            let destination_stake = claimable_settlement.stake_accounts[0];
            let destination_type = get_stake_state_type(&destination_stake.2, clock, stake_history);
            let possible_to_merge = claimable_settlement.stake_accounts.iter().skip(1).collect();
            settlements_with_merge_operation.insert(claimable_settlement.settlement_address);
            Some((destination_stake.0, destination_type, possible_to_merge))
        } else {
            None
        };
        if let Some((destination_stake, destination_type, possible_to_merge)) =
            mergeable_stake_accounts
        {
            prepare_merge_instructions(
                possible_to_merge,
                destination_stake,
                destination_type,
                &claimable_settlement.settlement_address,
                None,
                program,
                config_address,
                &find_settlement_staker_authority(&claimable_settlement.settlement_address).0,
                transaction_builder,
                clock,
                stake_history,
            )
            .await?;
        }
    }
    let execution_result = execute_parallel(
        rpc_client.clone(),
        transaction_executor.clone(),
        transaction_builder,
        priority_fee_policy,
    )
    .await;
    reporting.add_tx_execution_result(execution_result, "MergeSettlementStakeAccounts");
    // after execution let's consult which stake accounts were not merged
    let (withdrawer_authority, _) = find_bonds_withdrawer_authority(config_address);
    for settlement_address in settlements_with_merge_operation {
        let (stake_authority, _) = find_settlement_staker_authority(&settlement_address);
        for s in claimable_settlements
            .iter_mut()
            .filter(|s| s.settlement_address == settlement_address)
        {
            let stake_accounts = collect_stake_accounts(
                rpc_client.clone(),
                Some(&withdrawer_authority),
                Some(&stake_authority),
            )
            .await?;
            s.stake_accounts = stake_accounts;
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn claim_settlement<'a>(
    program: &Program<Arc<DynSigner>>,
    rpc_client: Arc<RpcClient>,
    transaction_builder: &mut TransactionBuilder,
    transaction_executor: Arc<TransactionExecutor>,
    claimable_settlement: ClaimableSettlementsReturn,
    settlement_json_data: &'a SettlementRecord,
    config_address: &Pubkey,
    priority_fee_policy: &PriorityFeePolicy,
    reporting: &mut ReportHandler<ClaimSettlementReport>,
    settlement_claimed_amounts: &mut HashMap<Pubkey, u64>,
    stake_accounts_to_cache: &mut StakeAccountsCache<'a>,
    minimal_stake_lamports: u64,
    clock: &Clock,
    stake_history: &StakeHistory,
) -> anyhow::Result<()> {
    let (bonds_withdrawer_authority, _) = find_bonds_withdrawer_authority(config_address);
    let empty_stake_accounts: CollectedStakeAccounts = vec![];
    for tree_node in settlement_json_data.tree_nodes.iter() {
        assert_eq!(
            claimable_settlement.settlement_address,
            settlement_json_data.settlement_address
        );
        if claimable_settlement
            .settlement_claims
            .is_set(tree_node.index)
        {
            debug!("Settlement claim {} already exists for tree node stake:{}/withdrawer:{}/claim:{}/index:{}, settlement {}",
                    claimable_settlement.settlement_address, tree_node.stake_authority, tree_node.withdraw_authority,
                    lamports_to_sol(tree_node.claim),
                    tree_node.index,
                    settlement_json_data.settlement_address);
            continue;
        }
        let proof = if let Some(proof) = tree_node.proof.clone() {
            proof
        } else {
            reporting.add_error_string(format!(
                "No proof found for tree node stake:{}/withdrawer:{}/claim:{}/index:{}, settlement {}",
                tree_node.stake_authority,
                tree_node.withdraw_authority,
                lamports_to_sol(tree_node.claim),
                tree_node.index,
                settlement_json_data.settlement_address,
            ));
            continue;
        };

        let stake_account_from = {
            let stake_account_from =
                claimable_settlement
                    .stake_accounts
                    .iter()
                    .find(|(pubkey, lamports, _)| {
                        let utilized_lamports =
                            settlement_claimed_amounts.entry(*pubkey).or_insert(0);
                        if lamports
                            .saturating_sub(*utilized_lamports)
                            .saturating_sub(minimal_stake_lamports)
                            >= tree_node.claim
                        {
                            settlement_claimed_amounts
                                .entry(*pubkey)
                                .and_modify(|e| *e += tree_node.claim);
                            true
                        } else {
                            false
                        }
                    });
            if let Some((pubkey, _, _)) = stake_account_from {
                *pubkey
            } else {
                reporting.add_error_string(format!(
                    "No stake account found with enough SOLs to claim {} from, settlement {}, index: {}, epoch {}",
                    lamports_to_sol(tree_node.claim),
                    settlement_json_data.settlement_address,
                    tree_node.index,
                    claimable_settlement.settlement.epoch_created_for
                ));
                reporting.reportable.update_no_account_from(
                    &settlement_json_data.settlement_address,
                    tree_node.claim,
                );
                continue;
            }
        };

        let stake_accounts_to = stake_accounts_to_cache
            .get(
                rpc_client.clone(),
                &tree_node.withdraw_authority,
                &tree_node.stake_authority,
            )
            .await
            .map_or_else(
                |e| {
                    reporting.add_error(e);
                    &empty_stake_accounts
                },
                |v| v,
            );
        let stake_account_to = prioritize_for_claiming(
            stake_accounts_to,
            clock,
            stake_history,
        ).map_or_else(|e| {
            reporting.add_error_string(format!(
                "No available stake account found where to claim into of staker/withdraw authorities {}/{} (settlement: {}, claim: {}, index: {}): {:?}",
                tree_node.stake_authority, tree_node.withdraw_authority,
                settlement_json_data.settlement_address,
                tree_node.claim,
                tree_node.index,
                e
            ));
            None
        }, Some);
        let stake_account_to: Pubkey = if let Some(stake_account_to) = stake_account_to {
            stake_account_to
        } else {
            // stake accounts for these authorities were not found in this or some prior run (error was already reported)
            reporting
                .reportable
                .update_no_account_to(&settlement_json_data.settlement_address, tree_node.claim);
            continue;
        };

        let req = program
            .request()
            .accounts(validator_bonds::accounts::ClaimSettlementV2 {
                config: *config_address,
                bond: settlement_json_data.bond_address,
                settlement: settlement_json_data.settlement_address,
                settlement_claims: claimable_settlement.settlement_claims_address,
                stake_account_from,
                stake_account_to,
                bonds_withdrawer_authority,
                stake_history: stake_history_id,
                stake_program: stake_program_id,
                program: validator_bonds_id,
                clock: clock_id,
                event_authority: find_event_authority().0,
            })
            .args(validator_bonds::instruction::ClaimSettlementV2 {
                claim_settlement_args: ClaimSettlementV2Args {
                    proof,
                    stake_account_staker: tree_node.stake_authority,
                    stake_account_withdrawer: tree_node.withdraw_authority,
                    claim: tree_node.claim,
                    index: tree_node.index,
                    tree_node_hash: tree_node.hash().to_bytes(),
                },
            });
        add_instruction_to_builder(
            transaction_builder,
            &req,
            format!(
                "Claim Settlement {}, from {}, to {}",
                settlement_json_data.settlement_address, stake_account_from, stake_account_to
            ),
        )?;
    }

    let execution_result = execute_parallel_with_rate(
        rpc_client.clone(),
        transaction_executor.clone(),
        transaction_builder,
        priority_fee_policy,
        300,
    )
    .await;
    reporting.add_tx_execution_result(
        execution_result,
        format!(
            "ClaimSettlement {}",
            claimable_settlement.settlement_address
        ),
    );

    Ok(())
}

fn get_settlement_from_json<'a>(
    per_epoch_settlement_records: &'a HashMap<u64, Vec<SettlementRecord>>,
    on_chain_settlement: &ClaimableSettlementsReturn,
) -> Result<&'a SettlementRecord, CliError> {
    let settlement_epoch = on_chain_settlement.settlement.epoch_created_for;
    let settlement_merkle_tree =
        if let Some(settlement_merkle_tree) = per_epoch_settlement_records.get(&settlement_epoch) {
            settlement_merkle_tree
        } else {
            return Err(CliError::Processing(anyhow!(
                "No JSON merkle tree data found for settlement epoch {}",
                settlement_epoch
            )));
        };

    // find on-chain data match with json data
    let matching_settlement = settlement_merkle_tree.iter().find(|settlement_from_json| {
        settlement_from_json.settlement_address == on_chain_settlement.settlement_address
    });
    let matching_settlement = if let Some(settlement) = matching_settlement {
        settlement
    } else {
        return Err(CliError::Processing(anyhow!(
            "No matching JSON merkle-tree data has been found for on-chain settlement {}, bond {} in epoch {}",
            on_chain_settlement.settlement_address,
            on_chain_settlement.settlement.bond,
            settlement_epoch
        )));
    };

    if on_chain_settlement.settlement.max_total_claim != matching_settlement.max_total_claim_sum
        || on_chain_settlement.settlement.merkle_root != matching_settlement.merkle_root
    {
        return Err(CliError::Processing(anyhow!(
            "Mismatch between on-chain settlement and JSON data for settlement {}, bond {} in epoch {}",
            on_chain_settlement.settlement_address,
            on_chain_settlement.settlement.bond,
            settlement_epoch
        )));
    }
    if on_chain_settlement.stake_accounts.is_empty() {
        return Err(CliError::Processing(anyhow!(
            "No stake accounts found on-chain for settlement {}",
            on_chain_settlement.settlement_address
        )));
    }
    Ok(matching_settlement)
}

/// Filter provided Vec(settlement pubkey, settlement claims pubkey, settlement claims) for the given settlement pubkey
/// returns number of claimed records in bitmap, if bitmap not found then 0
fn filter_settlement_claims_for_claimed_records(
    settlement_pubkey: &Pubkey,
    settlement_claims: &Vec<(Pubkey, Pubkey, Option<SettlementClaimsBitmap>)>,
    report: &mut Vec<String>,
) -> u64 {
    if settlement_claims.is_empty() {
        let err_msg = format!(
            "No settlement claims found for settlement pubkey: {}",
            settlement_pubkey
        );
        error!("{}", err_msg);
        report.push(err_msg);
        0_u64
    } else {
        let claims = settlement_claims
            .iter()
            .find(|(s_pubkey, _, _)| s_pubkey == settlement_pubkey);
        if let Some((_, _, Some(settlement_claims))) = claims {
            settlement_claims.number_of_set_bits()
        } else {
            let err_msg = format!(
                "No settlement claims found for settlement pubkey: {}",
                settlement_pubkey
            );
            error!("{}", err_msg);
            report.push(err_msg);
            0_u64
        }
    }
}

struct ClaimSettlementReport {
    rpc_client: Option<Arc<RpcClient>>,
    // settlement pubkey -> number of claimed merkle tree nodes
    settlements_claimable_before: HashMap<Pubkey, u64>,
    // settlement pubkey -> amount for settlement claimed before
    claimed_before: HashMap<Pubkey, u64>,
    settlements_claimable_no_account_to: HashMap<Pubkey, u64>,
    settlements_claimable_no_account_from: HashMap<Pubkey, u64>,
}

impl PrintReportable for ClaimSettlementReport {
    fn get_report(&self) -> Pin<Box<dyn Future<Output = Vec<String>> + '_>> {
        Box::pin(async {
            let rpc_client = if let Some(rpc_client) = &self.rpc_client {
                rpc_client
            } else {
                return vec!["No report available, not initialized yet.".to_string()];
            };
            let claimable_settlements_addresses: Vec<Pubkey> =
                self.settlements_claimable_before.keys().copied().collect();
            sleep(std::time::Duration::from_secs(8)).await; // waiting for data finalization on-chain
            let settlements_claimable_after =
                get_settlements_for_pubkeys(rpc_client.clone(), &claimable_settlements_addresses)
                    .await;
            let settlement_claims_after = get_settlement_claims_for_settlement_pubkeys(
                rpc_client.clone(),
                &claimable_settlements_addresses,
            )
            .await;
            match (settlements_claimable_after, settlement_claims_after) {
                (Ok(settlements_claimable_after), Ok(settlement_claims_after)) => {
                    let mut grouped_by_epoch: HashMap<_, Vec<_>> = HashMap::new();
                    for (pubkey, settlement) in settlements_claimable_after {
                        let epoch = settlement.as_ref().map_or(0, |s| s.epoch_created_for);
                        grouped_by_epoch
                            .entry(epoch)
                            .or_insert_with(Vec::new)
                            .push((pubkey, settlement));
                    }
                    let mut report: Vec<String> = vec![];
                    for epoch in grouped_by_epoch.keys() {
                        let mut settlement_claimes_claimed_now: u64 = 0;
                        let settlements_claimable_after_group = grouped_by_epoch
                            .get(epoch)
                            .expect("Epoch key expected to exist when iterating over keys");
                        let mut epoch_report: Vec<String> = vec![];
                        for (settlement_address, settlement) in settlements_claimable_after_group {
                            let max_claimed =
                                settlement.as_ref().map_or_else(|| 0, |s| s.max_total_claim);
                            let max_nodes = settlement
                                .as_ref()
                                .map_or_else(|| 0, |s| s.max_merkle_nodes);
                            let claimed_before = self
                                .claimed_before
                                .get(settlement_address)
                                .map_or_else(|| 0, |claimed_before| *claimed_before);
                            let claimed_after = settlement
                                .as_ref()
                                .map_or_else(|| 0, |s| s.lamports_claimed);
                            let claimed_diff = claimed_after.saturating_sub(claimed_before);
                            let stake_account_to = self
                                .settlements_claimable_no_account_to
                                .get(settlement_address)
                                .unwrap_or(&0);
                            let stake_account_from = self
                                .settlements_claimable_no_account_from
                                .get(settlement_address)
                                .unwrap_or(&0);
                            let settlement_claims_count_before = self
                                .settlements_claimable_before
                                .get(settlement_address)
                                .map_or_else(|| 0, |v| *v);
                            let settlement_claims_count_after =
                                filter_settlement_claims_for_claimed_records(
                                    settlement_address,
                                    &settlement_claims_after,
                                    &mut report,
                                );
                            let settlement_claims_count_diff = settlement_claims_count_after
                                .saturating_sub(settlement_claims_count_before);
                            settlement_claimes_claimed_now += settlement_claims_count_diff;
                            epoch_report.push(format!(
                                "  Settlement {} in sum claimed SOLs {}/{} SOLs, claimed merkle nodes {}/{}. \n    This time claimed SOLs {}, merkle nodes {} (not claimed reason: no target {}, no source: {})",
                                settlement_address,
                                lamports_to_sol(claimed_after),
                                lamports_to_sol(max_claimed),
                                settlement_claims_count_after,
                                max_nodes,
                                lamports_to_sol(claimed_diff),
                                settlement_claims_count_diff,
                                lamports_to_sol(*stake_account_to),
                                lamports_to_sol(*stake_account_from),
                            ));
                        }
                        report.push(format!(
                            "Epoch {}, this time claimed {} merkle nodes",
                            epoch, settlement_claimes_claimed_now,
                        ));
                        report.extend(epoch_report);
                    }
                    report
                }
                (e1, e2) => {
                    vec![format!(
                        "Error reporting settlement claiming: settlements: {:?}, claims: {:?}",
                        e1, e2
                    )]
                }
            }
        })
    }
}

impl ClaimSettlementReport {
    fn report_handler() -> ReportHandler<Self> {
        let reportable = Self {
            rpc_client: None,
            claimed_before: HashMap::new(),
            settlements_claimable_before: HashMap::new(),
            settlements_claimable_no_account_to: HashMap::new(),
            settlements_claimable_no_account_from: HashMap::new(),
        };
        ReportHandler::new(reportable)
    }

    fn init(
        &mut self,
        rpc_client: Arc<RpcClient>,
        claimable_settlements: &[ClaimableSettlementsReturn],
    ) {
        info!(
            "Number of claimable settlements: {}",
            claimable_settlements.len()
        );
        self.rpc_client = Some(rpc_client);
        self.settlements_claimable_before = claimable_settlements
            .iter()
            .map(|s| {
                (
                    s.settlement_address,
                    s.settlement_claims.number_of_set_bits(),
                )
            })
            .collect::<HashMap<Pubkey, u64>>();
        self.settlements_claimable_no_account_to = claimable_settlements
            .iter()
            .map(|s| (s.settlement_address, 0_u64))
            .collect::<HashMap<Pubkey, u64>>();
        self.settlements_claimable_no_account_from = claimable_settlements
            .iter()
            .map(|s| (s.settlement_address, 0_u64))
            .collect::<HashMap<Pubkey, u64>>();
        self.claimed_before = claimable_settlements
            .iter()
            .map(|s| (s.settlement_address, s.settlement.lamports_claimed))
            .collect::<HashMap<Pubkey, u64>>();
    }

    /// issue of no stake account to claim from, adding to report
    fn update_no_account_from(&mut self, settlement_address: &Pubkey, tree_node_claim: u64) {
        if let Some(value) = self
            .settlements_claimable_no_account_from
            .get_mut(settlement_address)
        {
            *value += tree_node_claim;
        }
    }

    /// issue of no stake account to claim to, adding to report
    fn update_no_account_to(&mut self, settlement_address: &Pubkey, tree_node_claim: u64) {
        if let Some(value) = self
            .settlements_claimable_no_account_to
            .get_mut(settlement_address)
        {
            *value += tree_node_claim;
        }
    }
}
