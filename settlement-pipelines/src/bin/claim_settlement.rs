use anchor_client::{DynSigner, Program};
use anyhow::anyhow;
use clap::Parser;
use log::{debug, error, info};
use serde::Serialize;
use settlement_pipelines::anchor::add_instruction_to_builder;
use settlement_pipelines::arguments::{
    init_from_opts, GlobalOpts, InitializedGlobalOpts, PriorityFeePolicyOpts, ReportOpts,
    TipPolicyOpts,
};
use settlement_pipelines::cli_result::{CliError, CliResult};
use settlement_pipelines::executor::execute_parallel;
use settlement_pipelines::init::{get_executor, init_log};
use settlement_pipelines::json_data::load_merkle_tree_collections;
use settlement_pipelines::reporting::{
    with_reporting_ext, PrintReportable, ReportHandler, ReportSerializable,
};
use settlement_pipelines::reporting_data::{ReportingReasonSettlement, SettlementsReportData};
use settlement_pipelines::settlement_data::{parse_from_merkle_tree_collections, SettlementRecord};
use settlement_pipelines::settlements::{list_claimable_settlements, ClaimableSettlementsReturn};
use settlement_pipelines::stake_accounts::{
    get_stake_state_type, prepare_merge_instructions, prioritize_for_claiming,
    STAKE_ACCOUNT_RENT_EXEMPTION,
};
use settlement_pipelines::stake_accounts_cache::StakeAccountsCache;
use settlement_pipelines::FINALIZATION_WAIT_TIMEOUT;
use solana_cli_output::display::build_balance_message;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::clock::Clock;
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
use validator_bonds::state::settlement::{
    find_settlement_claims_address, find_settlement_staker_authority, Settlement,
};
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

    /// Merkle tree collection JSON files.
    /// Each file contains a self-contained MerkleTreeCollection with all necessary data.
    #[arg(required = true, short = 'f', long, value_delimiter = ' ', num_args(1..))]
    json_files: Vec<PathBuf>,

    /// forcing epoch, overriding ones loaded from json files of settlement_json_files
    /// mostly useful for testing purposes
    #[arg(long)]
    epoch: Option<u64>,

    #[clap(flatten)]
    priority_fee_policy_opts: PriorityFeePolicyOpts,

    #[clap(flatten)]
    tip_policy_opts: TipPolicyOpts,

    #[clap(flatten)]
    report_opts: ReportOpts,
}

#[tokio::main]
async fn main() -> CliResult {
    let args: Args = Args::parse();
    let mut reporting = ClaimSettlementsReport::report_handler();
    let result = real_main(&mut reporting, &args).await;
    with_reporting_ext::<ClaimSettlementsReport>(&mut reporting, result, &args.report_opts).await
}

async fn real_main(
    reporting: &mut ReportHandler<ClaimSettlementsReport>,
    args: &Args,
) -> anyhow::Result<()> {
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

    let collections = load_merkle_tree_collections(&args.json_files, args.global_opts.config)?;
    if collections.is_empty() {
        return Err(anyhow!(
            "No merkle tree collections loaded from provided files"
        ));
    }

    // Resolve config address: from CLI or from merkle tree
    let config_address = args.global_opts.config.unwrap_or_else(|| {
        let config = collections[0].validator_bonds_config;
        info!("Using config address from merkle tree: {config}");
        config
    });
    info!("Claiming settlements for validator-bonds config: {config_address}");
    let config = get_config(rpc_client.clone(), config_address)
        .await
        .map_err(CliError::retry_able)?;

    let minimal_stake_lamports = config.minimum_stake_lamports + STAKE_ACCOUNT_RENT_EXEMPTION;

    let json_loaded_settlements_per_epoch =
        parse_from_merkle_tree_collections(&collections, args.epoch).map_err(CliError::critical)?;

    // loaded from RPC on-chain data
    let mut claimable_settlements =
        list_claimable_settlements(rpc_client.clone(), &config_address, &config).await?;

    reporting.reportable.init(
        rpc_client.clone(),
        &json_loaded_settlements_per_epoch,
        &claimable_settlements,
    );

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
        let json_matching_settlement = match get_settlement_from_json(
            &json_loaded_settlements_per_epoch,
            &claimable_settlement,
        ) {
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
            build_balance_message(json_matching_settlement.max_total_claim_sum, false, false),
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
    reporting: &mut ReportHandler<ClaimSettlementsReport>,
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
    reporting: &mut ReportHandler<ClaimSettlementsReport>,
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
                    build_balance_message(tree_node.claim, false, false),
                    tree_node.index,
                    settlement_json_data.settlement_address);
            continue;
        }
        let proof = if let Some(proof) = tree_node.proof.clone() {
            proof
        } else {
            reporting.error().with_msg(format!(
                "No proof found for tree node stake:{}/withdrawer:{}/claim:{}/index:{}, settlement {}",
                tree_node.stake_authority,
                tree_node.withdraw_authority,
                build_balance_message(tree_node.claim, false, false),
                tree_node.index,
                settlement_json_data.settlement_address,
            )).add();
            continue;
        };
        if tree_node.claim == 0 {
            reporting.warning().with_msg(format!(
                "Tree node claim is zero for stake:{}/withdrawer:{}/claim:{}/index:{}, settlement {}",
                tree_node.stake_authority,
                tree_node.withdraw_authority,
                build_balance_message(tree_node.claim, false, false),
                tree_node.index,
                settlement_json_data.settlement_address,
            )).add();
            continue;
        }

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
                reporting.warning().with_msg(format!(
                    "No stake account found with enough SOLs to claim {} from, settlement {}, index: {}, epoch {}",
                    build_balance_message(tree_node.claim, false, false),
                    settlement_json_data.settlement_address,
                    tree_node.index,
                    claimable_settlement.settlement.epoch_created_for
                )).add();
                reporting
                    .reportable
                    .update_no_account_from(settlement_json_data, tree_node.claim);
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
            .unwrap_or_else(|e| {
                reporting.error().with_err(e).add();
                &empty_stake_accounts
            });
        let stake_account_to = prioritize_for_claiming(
            stake_accounts_to,
            clock,
            stake_history,
        ).map_or_else(|e| {
            reporting.warning().with_msg(format!(
                "No available stake account found where to claim into of staker/withdraw authorities {}/{} (epoch: {}, settlement: {}, claim: {}, index: {}): {:?}",
                tree_node.stake_authority, tree_node.withdraw_authority,
                settlement_json_data.epoch,
                settlement_json_data.settlement_address,
                tree_node.claim,
                tree_node.index,
                e
            )).add();
            None
        }, Some);
        let stake_account_to: Pubkey = if let Some(stake_account_to) = stake_account_to {
            stake_account_to
        } else {
            // stake accounts for these authorities were not found in this or some prior run (error was already reported)
            reporting
                .reportable
                .update_no_account_to(settlement_json_data, tree_node.claim);
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

    let execution_result = execute_parallel(
        rpc_client.clone(),
        transaction_executor.clone(),
        transaction_builder,
        priority_fee_policy,
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
    let settlement_merkle_tree = if let Some(settlement_merkle_tree) =
        per_epoch_settlement_records.get(&settlement_epoch)
    {
        settlement_merkle_tree
    } else {
        return Err(CliError::Critical(anyhow!(
                "No JSON merkle tree data found for settlement {} epoch {}, probably missing JSON input data for epoch (e.g., bidding/rewards or protected-events data)",
                on_chain_settlement.settlement_address,
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
        return Err(CliError::Critical(anyhow!(
            "No matching JSON merkle-tree data has been found for on-chain settlement {}, bond {} in epoch {}",
            on_chain_settlement.settlement_address,
            on_chain_settlement.settlement.bond,
            settlement_epoch
        )));
    };

    if on_chain_settlement.settlement.max_total_claim != matching_settlement.max_total_claim_sum
        || on_chain_settlement.settlement.merkle_root != matching_settlement.merkle_root
    {
        return Err(CliError::Critical(anyhow!(
            "Mismatch between on-chain settlement and JSON data for settlement {}, bond {} in epoch {}",
            on_chain_settlement.settlement_address,
            on_chain_settlement.settlement.bond,
            settlement_epoch
        )));
    }
    if on_chain_settlement.stake_accounts.is_empty() {
        return Err(CliError::Critical(anyhow!(
            "No stake accounts found on-chain for settlement {}",
            on_chain_settlement.settlement_address
        )));
    }
    Ok(matching_settlement)
}

struct ClaimSettlementsReport {
    rpc_client: Option<Arc<RpcClient>>,
    settlements_per_epoch: HashMap<u64, ClaimSettlementReport>,
}

#[derive(Default, Debug)]
struct AlreadyClaimed {
    number_of_set_bits: u64,
    lamports_claimed: u64,
    lamports_funded: u64,
    max_total_claim: u64,
    max_merkle_nodes: u64,
}

impl AlreadyClaimed {
    fn claimed(&self) -> (u64, u64) {
        (self.number_of_set_bits, self.lamports_claimed)
    }

    fn total(&self) -> (u64, u64) {
        (self.max_merkle_nodes, self.max_total_claim)
    }
}

#[derive(Default)]
struct ClaimSettlementReport {
    json_loaded_settlements: HashSet<SettlementRecord>,
    // settlement pubkey -> (number of claimed merkle tree nodes, amount claimed)
    already_claimed: HashMap<Pubkey, AlreadyClaimed>,
    // reason why claiming was not possible with amounts
    settlements_claimable_no_account_to: HashMap<Pubkey, u64>,
    settlements_claimable_no_account_from: HashMap<Pubkey, u64>,
}

impl ClaimSettlementsReport {
    fn report_handler() -> ReportHandler<Self> {
        let claim_settlement_report = Self {
            rpc_client: None,
            settlements_per_epoch: HashMap::new(),
        };
        ReportHandler::new(claim_settlement_report)
    }

    fn init(
        &mut self,
        rpc_client: Arc<RpcClient>,
        json_loaded_data: &HashMap<u64, Vec<SettlementRecord>>,
        claimable_settlements: &[ClaimableSettlementsReturn],
    ) {
        info!(
            "Number of claimable settlements: {} [{}]; JSON data: [{}]",
            claimable_settlements.len(),
            claimable_settlements
                .iter()
                .fold(HashMap::new(), |mut acc, item| {
                    *acc.entry(item.settlement.epoch_created_for).or_insert(0) += 1;
                    acc
                })
                .iter()
                .map(|(epoch, count)| format!("{epoch}: {count}"))
                .collect::<Vec<_>>()
                .join(", "),
            json_loaded_data
                .iter()
                .map(|(k, v)| format!("epoch {}: {}", k, v.len()))
                .collect::<Vec<_>>()
                .join(", ")
        );
        self.rpc_client = Some(rpc_client);
        for claimable_settlement in claimable_settlements {
            let report = self.mut_ref(claimable_settlement.settlement.epoch_created_for);
            // we expect the claimable settlement is not loaded as multiple items from chain
            if let Some(already_claimed) = report
                .already_claimed
                .get(&claimable_settlement.settlement_address)
            {
                error!(
                    "Claimable settlement {} already loaded ({:?}, new: ({:?}, {})), skipping",
                    claimable_settlement.settlement_address,
                    already_claimed,
                    claimable_settlement.settlement,
                    claimable_settlement.settlement_claims.number_of_set_bits()
                );
                continue;
            } else {
                report.already_claimed.insert(
                    claimable_settlement.settlement_address,
                    AlreadyClaimed {
                        number_of_set_bits: claimable_settlement
                            .settlement_claims
                            .number_of_set_bits(),
                        lamports_claimed: claimable_settlement.settlement.lamports_claimed,
                        lamports_funded: claimable_settlement.settlement.lamports_funded,
                        max_total_claim: claimable_settlement.settlement.max_total_claim,
                        max_merkle_nodes: claimable_settlement.settlement.max_merkle_nodes,
                    },
                );
                report
                    .settlements_claimable_no_account_to
                    .insert(claimable_settlement.settlement_address, 0_u64);
                report
                    .settlements_claimable_no_account_from
                    .insert(claimable_settlement.settlement_address, 0_u64);
            }
        }
        for (epoch, record) in json_loaded_data {
            let report = self.mut_ref(*epoch);
            report
                .json_loaded_settlements
                .extend(record.iter().cloned());
        }
    }

    /// issue of no stake account to claim from, adding to report
    fn update_no_account_from(
        &mut self,
        settlement_record: &SettlementRecord,
        tree_node_claim: u64,
    ) {
        let report = self.mut_ref(settlement_record.epoch);
        Self::update_no_account(
            &mut report.settlements_claimable_no_account_from,
            &settlement_record.settlement_address,
            tree_node_claim,
        );
    }

    /// issue of no stake account to claim to, adding to report
    fn update_no_account_to(&mut self, settlement_record: &SettlementRecord, tree_node_claim: u64) {
        let report = self.mut_ref(settlement_record.epoch);
        Self::update_no_account(
            &mut report.settlements_claimable_no_account_to,
            &settlement_record.settlement_address,
            tree_node_claim,
        );
    }

    fn update_no_account(
        map: &mut HashMap<Pubkey, u64>,
        settlement_address: &Pubkey,
        tree_node_claim: u64,
    ) {
        map.entry(*settlement_address)
            .and_modify(|no_account| *no_account += tree_node_claim)
            .or_insert_with(|| tree_node_claim);
    }

    fn mut_ref(&mut self, epoch: u64) -> &mut ClaimSettlementReport {
        self.settlements_per_epoch.entry(epoch).or_default()
    }

    /// returns settlements from chain, mapping: settlement pubkey -> (Settlement, SettlementClaimsBitmap)
    async fn load_settlements_from_chain(
        &self,
    ) -> anyhow::Result<HashMap<Pubkey, Option<(Settlement, SettlementClaimsBitmap)>>> {
        let rpc_client = if let Some(rpc_client) = &self.rpc_client {
            rpc_client
        } else {
            return Err(anyhow!("No report available, not initialized yet."));
        };

        let settlements_at_init = self
            .settlements_per_epoch
            .values()
            .flat_map(|report| report.already_claimed.keys())
            .cloned()
            .collect::<Vec<Pubkey>>();

        // Vec <Settlement pubkey, Settlement data>
        let settlements =
            get_settlements_for_pubkeys(rpc_client.clone(), &settlements_at_init).await;
        // Vec <Settlement pubkey, Settlement Claim pubkey, Settlement Claim data>
        let settlement_claims =
            get_settlement_claims_for_settlement_pubkeys(rpc_client.clone(), &settlements_at_init)
                .await;

        let mut settlements_map: HashMap<Pubkey, Option<(Settlement, SettlementClaimsBitmap)>> =
            HashMap::new();

        match (settlements, settlement_claims) {
            (Ok(settlements), Ok(settlement_claims)) => {
                let mut settlement_claims_map = settlement_claims
                    .into_iter()
                    .map(|(settlement_pubkey, _, claim)| (settlement_pubkey, claim))
                    .collect::<HashMap<_, _>>();
                for (pubkey, settlement) in settlements {
                    let settlement_claims_data = settlement_claims_map.remove(&pubkey);
                    let settlement_data = if let (Some(settlement), Some(Some(settlement_claims))) =
                        (settlement, settlement_claims_data)
                    {
                        Some((settlement, settlement_claims))
                    } else {
                        let settlement_claims_pubkey = find_settlement_claims_address(&pubkey).0;
                        debug!(
                            "[Reporting] Data for Settlement accounts {pubkey}/{settlement_claims_pubkey} not found on-chain"
                        );
                        None
                    };
                    settlements_map.insert(pubkey, settlement_data);
                }
            }
            (e1, e2) => {
                return Err(anyhow!(
                    "Error load settlement claiming: settlements: {e1:?}, claims: {e2:?}"
                ));
            }
        };

        Ok(settlements_map)
    }
}

impl ClaimSettlementReport {
    /// returns sum of already claimed (merkle tree nodes, amount claimed)
    fn sum_already_claimed(&self) -> AlreadyClaimed {
        self.already_claimed
            .values()
            .fold(AlreadyClaimed::default(), |acc, claimed| AlreadyClaimed {
                number_of_set_bits: acc.number_of_set_bits + claimed.number_of_set_bits,
                lamports_claimed: acc.lamports_claimed + claimed.lamports_claimed,
                lamports_funded: acc.lamports_funded + claimed.lamports_funded,
                max_total_claim: acc.max_total_claim + claimed.max_total_claim,
                max_merkle_nodes: acc.max_merkle_nodes + claimed.max_merkle_nodes,
            })
    }

    /// (sum merkle nodes, sum lamports)
    fn sum_json_loaded_settlements(&self) -> (u64, u64) {
        self.json_loaded_settlements
            .iter()
            .fold((0, 0), |(nodes, lamports), next| {
                (
                    nodes + next.max_total_claim,
                    lamports + next.max_total_claim_sum,
                )
            })
    }

    fn sum_claimed(values: &HashMap<Pubkey, (u64, u64)>) -> (u64, u64) {
        values.values().fold((0, 0), |acc, (nodes, lamports)| {
            (acc.0 + nodes, acc.1 + lamports)
        })
    }

    /// (settlements number, nodes, lamports) by reason
    fn sum_by_reason(
        &self,
        nodes_and_amounts: &HashMap<Pubkey, (u64, u64)>,
    ) -> HashMap<ReportingReasonSettlement, (u64, u64, u64)> {
        let settlement_pubkeys = nodes_and_amounts.keys().cloned().collect::<Vec<_>>();
        let by_reason = SettlementsReportData::group_by_reason(
            &self.json_loaded_settlements,
            &settlement_pubkeys,
        );

        by_reason
            .into_iter()
            .map(|(reason, settlement_pubkeys)| {
                let (settlements_count, claimed_nodes, claimed_lamports) = settlement_pubkeys
                    .iter()
                    .map(|pubkey| {
                        nodes_and_amounts
                            .get(pubkey)
                            .map_or_else(|| (0, 0, 0), |(nodes, lamports)| (1, *nodes, *lamports))
                    })
                    .fold((0, 0, 0), |acc, (settlements, nodes, lamports)| {
                        (acc.0 + settlements, acc.1 + nodes, acc.2 + lamports)
                    });
                (reason, (settlements_count, claimed_nodes, claimed_lamports))
            })
            .collect()
    }

    /// returns sum of no stake account to claim (to, from)
    fn sum_update_no_account(&self) -> (u64, u64) {
        let sum_no_account_to = self.settlements_claimable_no_account_to.values().sum();
        let sum_no_account_from = self.settlements_claimable_no_account_from.values().sum();
        (sum_no_account_to, sum_no_account_from)
    }

    /// The info from epoch contains the list of settlements loaded from JSON files
    /// and the list of settlements that are already claimed on-chain.
    /// This method merges the lists and returns the list of pubkeys from both sources.
    fn all_known_settlement_pubkeys(&self) -> HashSet<Pubkey> {
        self.json_loaded_settlements
            .iter()
            .map(|settlement| settlement.settlement_address)
            .chain(self.already_claimed.keys().cloned())
            .collect()
    }
}

impl PrintReportable for ClaimSettlementsReport {
    fn get_report(&self) -> Pin<Box<dyn Future<Output = Vec<String>> + '_>> {
        Box::pin(async {
            sleep(FINALIZATION_WAIT_TIMEOUT).await; // waiting for data finalization on-chain
            let after_settlements = match self.load_settlements_from_chain().await {
                Ok(value) => value,
                Err(e) => return vec![format!("Error reporting settlement claiming: {:?}", e)],
            };

            let mut report: Vec<String> = vec![];

            for (epoch, settlements_report) in &self.settlements_per_epoch {
                let AlreadyClaimed {
                    number_of_set_bits: already_claimed_nodes,
                    lamports_claimed: already_claimed_lamports,
                    lamports_funded: already_funded_lamports,
                    max_total_claim: total_claim_amount,
                    max_merkle_nodes: total_claim_nodes,
                    ..
                } = settlements_report.sum_already_claimed();
                let (json_loaded_nodes, json_loaded_lamports) =
                    settlements_report.sum_json_loaded_settlements();
                let (no_account_to, no_account_from) = settlements_report.sum_update_no_account();
                let after_amounts = after_settlements
                    .iter()
                    .map(|(settlement_pubkey, settlement)| {
                        settlement.as_ref().map_or_else(
                            || (*settlement_pubkey, (0, 0, 0)),
                            |(s, c)| {
                                if s.epoch_created_for == *epoch {
                                    (
                                        *settlement_pubkey,
                                        (1, c.number_of_set_bits(), s.lamports_claimed),
                                    )
                                } else {
                                    (*settlement_pubkey, (0, 0, 0))
                                }
                            },
                        )
                    })
                    .collect::<HashMap<_, (u64, u64, u64)>>();
                let after_settlements_count = after_amounts.iter().filter(|(_, v)| v.0 > 0).count();
                let after_amounts = after_amounts
                    .iter()
                    .map(|(p, v)| (*p, (v.1, v.2)))
                    .collect::<HashMap<_, _>>();
                let (after_claimed_nodes, after_claimed_lamports) =
                    ClaimSettlementReport::sum_claimed(&after_amounts);
                let (now_claimed_nodes, now_claimed_lamports) = (
                    after_claimed_nodes.saturating_sub(already_claimed_nodes),
                    after_claimed_lamports.saturating_sub(already_claimed_lamports),
                );

                report.push(format!(
                    "Epoch {}, on-chain claimable settlements {}, this time claimed {}/{} merkle nodes in amount of {}/{} SOLs [loaded JSON {}, {}] (not claimed reason: no target {}, no source: {})",
                    epoch,
                    after_settlements_count,
                    now_claimed_nodes,
                    total_claim_nodes,
                    build_balance_message(now_claimed_lamports, false, false),
                    build_balance_message(total_claim_amount, false, false),
                    json_loaded_nodes,
                    build_balance_message(json_loaded_lamports, false, true),
                    build_balance_message(no_account_to, false, false),
                    build_balance_message(no_account_from, false, false),
                    ));
                if total_claim_nodes != json_loaded_nodes {
                    report.push(format!(
                        "  [WARNING] JSON Merkle nodes {json_loaded_nodes} do not match the Merkle nodes available on-chain {total_claim_nodes}"
                    ));
                }
                report.push(format!(
                    "  - before this already claimed {}/{} merkle nodes with {}/{} SOLs, funded {}",
                    already_claimed_nodes,
                    total_claim_nodes,
                    build_balance_message(already_claimed_lamports, false, false),
                    build_balance_message(total_claim_amount, false, false),
                    build_balance_message(already_funded_lamports, false, true),
                ));

                let already_by_reason = settlements_report.sum_by_reason(
                    &settlements_report
                        .already_claimed
                        .iter()
                        .map(|(p, i)| (*p, i.claimed()))
                        .collect(),
                );
                let total_by_reason = settlements_report.sum_by_reason(
                    &settlements_report
                        .already_claimed
                        .iter()
                        .map(|(p, i)| (*p, i.total()))
                        .collect(),
                );
                let after_by_reason = settlements_report.sum_by_reason(&after_amounts);
                for reason in ReportingReasonSettlement::items() {
                    let (_, already_reason_nodes, already_reason_lamports) =
                        already_by_reason.get(&reason).copied().unwrap_or((0, 0, 0));
                    let (_, total_reason_nodes, total_reason_lamports) =
                        total_by_reason.get(&reason).copied().unwrap_or((0, 0, 0));
                    let (after_reason_settlements, after_reason_nodes, after_reason_lamports) =
                        after_by_reason.get(&reason).copied().unwrap_or((0, 0, 0));
                    if after_reason_settlements > 0 {
                        report.push(format!(
                            "  Reason {} settlements {} with {}/{} merkle nodes in amount of {}/{} SOLs (before already claimed {}/{} nodes, {}/{} SOLs)",
                            reason,
                            after_reason_settlements,
                            after_reason_nodes.saturating_sub(already_reason_nodes),
                            total_reason_nodes,
                            build_balance_message(after_reason_lamports.saturating_sub(already_reason_lamports), false, false),
                            build_balance_message(total_reason_lamports, false, false),
                            already_reason_nodes,
                            total_reason_nodes,
                            build_balance_message(already_reason_lamports, false, false),
                            build_balance_message(total_reason_lamports, false, false),
                        ));
                    } else {
                        report.push(format!(
                            "  Reason {reason}, UNKNOWN state (JSON data not provided)"
                        ));
                    }
                }

                // for debugging purposes to list settlements with issue to be loaded from chain
                let all_known_settlement_pubkeys =
                    settlements_report.all_known_settlement_pubkeys();
                let after_settlements_keys =
                    after_settlements.keys().cloned().collect::<HashSet<_>>();
                let settlements_not_found_for_epoch = all_known_settlement_pubkeys
                    .difference(&after_settlements_keys)
                    .collect::<Vec<_>>();
                if !settlements_not_found_for_epoch.is_empty() {
                    debug!(
                        "  Epoch {epoch}, settlements loaded at start from JSON/on-chain but not found during reporting: {settlements_not_found_for_epoch:?}"
                    );
                }

                // for debugging purposes list per settlement
                for (settlement_pubkey, settlement_data) in &settlements_report.already_claimed {
                    let AlreadyClaimed {
                        number_of_set_bits: before_nodes,
                        lamports_claimed: before_lamports,
                        max_merkle_nodes: total_nodes,
                        max_total_claim: total_lamports,
                        ..
                    } = settlement_data;
                    let (now_nodes, now_lamports) = if let Some((after_nodes, after_lamports)) =
                        after_amounts.get(settlement_pubkey)
                    {
                        (
                            after_nodes.saturating_sub(*before_nodes).to_string(),
                            build_balance_message(
                                after_lamports.saturating_sub(*before_lamports),
                                false,
                                false,
                            )
                            .to_string(),
                        )
                    } else {
                        ("UNKNOWN".to_string(), "UNKNOWN".to_string())
                    };

                    debug!(
                        "Now settlement {} claimed merkle nodes {}/{}, {}/{} SOLs (not claimed reason: no target {}, no source: {})",
                        settlement_pubkey,
                        now_nodes,
                        total_nodes,
                        now_lamports,
                        build_balance_message(*total_lamports, false, false),
                        build_balance_message(*settlements_report.settlements_claimable_no_account_to.get(settlement_pubkey).unwrap_or(&0), false, false),
                        build_balance_message(*settlements_report.settlements_claimable_no_account_from.get(settlement_pubkey).unwrap_or(&0), false, false),
                    );
                    debug!(
                        "  before this already claimed {}/{} settlements with {}/{} SOLs",
                        before_nodes,
                        total_nodes,
                        build_balance_message(*before_lamports, false, false),
                        build_balance_message(*total_lamports, false, false),
                    );
                }
            }

            report
        })
    }
}

#[derive(Debug, Clone, Serialize)]
struct ClaimSettlementJsonSummary {
    epochs: Vec<EpochClaimSummary>,
}

#[derive(Debug, Clone, Serialize)]
struct EpochClaimSummary {
    epoch: u64,
    claimable_settlements: u64,
    claimed_nodes: u64,
    total_nodes: u64,
    claimed_amount_sol: f64,
    total_amount_sol: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    json_nodes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    json_amount_sol: Option<f64>,
    reasons: Vec<ReasonClaimSummary>,
}

#[derive(Debug, Clone, Serialize)]
struct ReasonClaimSummary {
    reason: String,
    settlements: u64,
    claimed_nodes: u64,
    total_nodes: u64,
    claimed_amount_sol: f64,
    total_amount_sol: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    json_nodes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    json_amount_sol: Option<f64>,
}

impl ReportSerializable for ClaimSettlementsReport {
    fn command_name(&self) -> &'static str {
        "claim-settlement"
    }

    fn get_json_summary(&self) -> Pin<Box<dyn Future<Output = serde_json::Value> + '_>> {
        Box::pin(async {
            let lamports_to_sol = |lamports: u64| -> f64 { lamports as f64 / 1_000_000_000.0 };

            // Wait for finalization and load current state from chain (same as get_report)
            sleep(FINALIZATION_WAIT_TIMEOUT).await;
            let after_settlements = match self.load_settlements_from_chain().await {
                Ok(value) => value,
                Err(e) => {
                    return serde_json::json!({"error": format!("Failed to load settlements: {}", e)})
                }
            };

            let mut sorted_epochs: Vec<_> = self.settlements_per_epoch.iter().collect();
            sorted_epochs.sort_by_key(|(epoch, _)| *epoch);

            let epochs: Vec<EpochClaimSummary> = sorted_epochs
                .iter()
                .map(|(epoch, settlements_report)| {
                    let sum_initial = settlements_report.sum_already_claimed();
                    let (json_loaded_nodes, json_loaded_lamports) =
                        settlements_report.sum_json_loaded_settlements();

                    // Build after amounts from chain data (current state after claiming)
                    let after_amounts: HashMap<Pubkey, (u64, u64)> = after_settlements
                        .iter()
                        .filter_map(|(settlement_pubkey, settlement)| {
                            settlement.as_ref().and_then(|(s, c)| {
                                if s.epoch_created_for == **epoch {
                                    Some((
                                        *settlement_pubkey,
                                        (c.number_of_set_bits(), s.lamports_claimed),
                                    ))
                                } else {
                                    None
                                }
                            })
                        })
                        .collect();

                    let claimable_settlements = after_amounts
                        .iter()
                        .filter(|(_, v)| v.0 > 0 || v.1 > 0)
                        .count() as u64;
                    let claimable_settlements = if claimable_settlements > 0 {
                        claimable_settlements
                    } else {
                        settlements_report.already_claimed.len() as u64
                    };

                    // Sum the current claimed state from chain
                    let (after_claimed_nodes, after_claimed_lamports) =
                        ClaimSettlementReport::sum_claimed(&after_amounts);

                    let total_by_reason = settlements_report.sum_by_reason(
                        &settlements_report
                            .already_claimed
                            .iter()
                            .map(|(pk, c)| (*pk, (c.max_merkle_nodes, c.max_total_claim)))
                            .collect(),
                    );

                    let after_by_reason = settlements_report.sum_by_reason(&after_amounts);

                    // Build per-reason breakdown with current chain state
                    let reasons: Vec<ReasonClaimSummary> = ReportingReasonSettlement::items()
                        .into_iter()
                        .filter_map(|reason| {
                            let (settlements, total_nodes, total_lamports) =
                                total_by_reason.get(&reason).copied().unwrap_or((0, 0, 0));
                            let (_, claimed_nodes, claimed_lamports) =
                                after_by_reason.get(&reason).copied().unwrap_or((0, 0, 0));

                            // Skip reasons with no settlements
                            if settlements == 0 {
                                return None;
                            }

                            Some(ReasonClaimSummary {
                                reason: reason.to_string(),
                                settlements,
                                claimed_nodes,
                                total_nodes,
                                claimed_amount_sol: lamports_to_sol(claimed_lamports),
                                total_amount_sol: lamports_to_sol(total_lamports),
                                json_nodes: None,
                                json_amount_sol: None,
                            })
                        })
                        .collect();

                    EpochClaimSummary {
                        epoch: **epoch,
                        claimable_settlements,
                        claimed_nodes: after_claimed_nodes,
                        total_nodes: sum_initial.max_merkle_nodes,
                        claimed_amount_sol: lamports_to_sol(after_claimed_lamports),
                        total_amount_sol: lamports_to_sol(sum_initial.max_total_claim),
                        json_nodes: if json_loaded_nodes > 0 {
                            Some(json_loaded_nodes)
                        } else {
                            None
                        },
                        json_amount_sol: if json_loaded_lamports > 0 {
                            Some(lamports_to_sol(json_loaded_lamports))
                        } else {
                            None
                        },
                        reasons,
                    }
                })
                .collect();

            let summary = ClaimSettlementJsonSummary { epochs };

            serde_json::to_value(summary)
                .unwrap_or_else(|e| serde_json::json!({"error": e.to_string()}))
        })
    }
}
