use anchor_client::{DynSigner, Program};
use anyhow::anyhow;
use clap::Parser;
use log::{debug, error, info};
use merkle_tree::psr_claim::TreeNode;
use settlement_engine::merkle_tree_collection::MerkleTreeCollection;
use settlement_engine::settlement_claims::SettlementCollection;
use settlement_engine::utils::read_from_json_file;
use settlement_pipelines::anchor::add_instruction_to_builder;
use settlement_pipelines::arguments::{
    init_from_opts, load_keypair, GlobalOpts, InitializedGlobalOpts, PriorityFeePolicyOpts,
    TipPolicyOpts,
};
use settlement_pipelines::cli_result::{CliError, CliResult};
use settlement_pipelines::executor::execute_parallel_with_rate;
use settlement_pipelines::init::{get_executor, init_log};
use settlement_pipelines::json_data::{
    resolve_combined_optional, CombinedMerkleTreeSettlementCollections,
};
use settlement_pipelines::reporting::{with_reporting, PrintReportable, ReportHandler};
use settlement_pipelines::settlements::{
    list_claimable_settlements, ClaimableSettlementsReturn, SETTLEMENT_CLAIM_ACCOUNT_SIZE,
};
use settlement_pipelines::stake_accounts::{prioritize_for_claiming, STAKE_ACCOUNT_RENT_EXEMPTION};
use settlement_pipelines::stake_accounts_cache::StakeAccountsCache;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::clock::Clock;
use solana_sdk::native_token::lamports_to_sol;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signer::Signer;
use solana_sdk::stake::program::ID as stake_program_id;
use solana_sdk::stake_history::StakeHistory;
use solana_sdk::system_program;
use solana_sdk::sysvar::{clock::ID as clock_id, stake_history::ID as stake_history_id};
use solana_transaction_builder::TransactionBuilder;
use solana_transaction_executor::{PriorityFeePolicy, TransactionExecutor};
use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::rc::Rc;
use std::sync::Arc;
use tokio::time::sleep;
use validator_bonds::instructions::ClaimSettlementArgs;
use validator_bonds::state::bond::find_bond_address;
use validator_bonds::state::config::find_bonds_withdrawer_authority;
use validator_bonds::state::settlement::find_settlement_address;
use validator_bonds::state::settlement_claim::find_settlement_claim_address;
use validator_bonds::ID as validator_bonds_id;
use validator_bonds_common::config::get_config;
use validator_bonds_common::constants::find_event_authority;
use validator_bonds_common::settlement_claims::{
    collect_existence_settlement_claims_from_addresses, get_settlement_claims_for_settlement,
};
use validator_bonds_common::settlements::get_settlements_for_pubkeys;
use validator_bonds_common::stake_accounts::{get_stake_history, CollectedStakeAccounts};
use validator_bonds_common::utils::get_sysvar_clock;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[clap(flatten)]
    global_opts: GlobalOpts,

    /// List of JSON files with tree collection and settlements
    #[arg(
        short = 's',
        long,
        value_delimiter = ' ',
        num_args(1..),
    )]
    settlement_json_files: Vec<PathBuf>,

    /// forcing epoch, overriding ones loaded from json files of settlement_json_files
    /// mostly useful for testing purposes
    #[arg(long)]
    epoch: Option<u64>,

    #[clap(flatten)]
    priority_fee_policy_opts: PriorityFeePolicyOpts,

    #[clap(flatten)]
    tip_policy_opts: TipPolicyOpts,

    /// keypair payer for rent of accounts, if not provided, fee payer keypair is used
    #[arg(long)]
    rent_payer: Option<String>,
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

    let json_loaded_claiming_data = load_json(&args.settlement_json_files, args.epoch)?;

    let rent_payer = if let Some(rent_payer) = args.rent_payer.clone() {
        load_keypair(&rent_payer)?
    } else {
        fee_payer.clone()
    };

    let minimal_stake_lamports = config.minimum_stake_lamports + STAKE_ACCOUNT_RENT_EXEMPTION;

    // loaded from json files
    let json_per_epoch_claim_records = JsonClaimSettlementRecord::load_as_vec_per_epoch(
        json_loaded_claiming_data,
        config_address,
        args.epoch,
    );

    // loaded from RPC on-chain data
    let claimable_settlements =
        list_claimable_settlements(rpc_client.clone(), &config_address, &config).await?;

    reporting
        .reportable
        .init(rpc_client.clone(), &claimable_settlements);

    let mut transaction_builder = TransactionBuilder::limited(fee_payer.clone());
    transaction_builder.add_signer_checked(&rent_payer);
    let transaction_executor = get_executor(rpc_client.clone(), tip_policy);

    let clock = get_sysvar_clock(rpc_client.clone()).await?;
    let stake_history = get_stake_history(rpc_client.clone()).await?;

    let mut settlement_claimed_amounts: HashMap<Pubkey, u64> = HashMap::new();
    let mut stake_accounts_to_cache = StakeAccountsCache::default();

    for claimable_settlement in claimable_settlements {
        let json_matching_settlement =
            match get_settlement_from_json(&json_per_epoch_claim_records, &claimable_settlement) {
                Ok(json_record) => json_record,
                Err(e) => {
                    reporting.add_cli_error(e);
                    continue;
                }
            };

        // Loading SettlementClaim records for this settlement from RPC on-chain
        let (settlement_claims, already_claimed_count) =
            match get_existence_of_settlement_claims(rpc_client.clone(), json_matching_settlement)
                .await
            {
                Ok(settlement_claims) => {
                    let already_claimed = reporting.reportable.update_claim_records_before(
                        &json_matching_settlement.settlement_address,
                        &settlement_claims,
                    );
                    (settlement_claims, already_claimed)
                }
                Err(e) => {
                    reporting.add_cli_error(e);
                    continue;
                }
            };

        // TODO: before claiming there should be a check for merging stake accounts

        info!(
            "Claiming settlement {}, vote account {}, claim amount {}, for epoch {}, number of FROM stake accounts {}, already claimed nodes {}",
            claimable_settlement.settlement_address,
            json_matching_settlement.vote_account_address,
            lamports_to_sol(json_matching_settlement.max_total_claim_sum),
            claimable_settlement.settlement.epoch_created_for,
            claimable_settlement.stake_accounts.len(),
            already_claimed_count,
        );

        claim_settlement(
            &program,
            rpc_client.clone(),
            &mut transaction_builder,
            transaction_executor.clone(),
            claimable_settlement,
            json_matching_settlement,
            settlement_claims,
            &config_address,
            &rent_payer.pubkey(),
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

fn load_json(
    settlement_json_files: &[PathBuf],
    args_epoch: Option<u64>,
) -> anyhow::Result<HashMap<u64, CombinedMerkleTreeSettlementCollections>> {
    let mut json_data: HashMap<u64, MerkleTreeLoadedData> = HashMap::new();
    for path in settlement_json_files.iter().filter(|path| {
        if path.is_file() {
            debug!("Processing file: {:?}", path);
            true
        } else {
            debug!("Skipping file: {:?}, as it's not a file", path);
            false
        }
    }) {
        load_json_data_to_merkle_tree(path, &mut json_data)?;
    }
    let claiming_data = json_data
        .into_iter()
        .map(|(epoch, data)| {
            Ok((
                args_epoch.unwrap_or(epoch),
                resolve_combined_optional(data.merkle_tree_collection, data.settlement_collection)?,
            ))
        })
        .collect::<anyhow::Result<HashMap<_, _>>>()?;
    info!(
        "Loaded json data from {:?} for epochs: {:?}",
        settlement_json_files
            .iter()
            .map(|p| p.to_str())
            .collect::<Vec<_>>(),
        claiming_data.keys().collect::<Vec<_>>()
    );
    Ok(claiming_data)
}

fn load_json_data_to_merkle_tree(
    path: &PathBuf,
    loaded_data: &mut HashMap<u64, MerkleTreeLoadedData>,
) -> Result<(), CliError> {
    debug!("Loading data from file: {:?}", path);
    let json_loading_result = if let Ok(merkle_tree_collection) = read_from_json_file(path) {
        insert_merkle_tree_loaded_data(loaded_data, Some(merkle_tree_collection), None)
    } else if let Ok(settlement_collection) = read_from_json_file(path) {
        insert_merkle_tree_loaded_data(loaded_data, None, Some(settlement_collection))
    } else {
        Err(anyhow!("Cannot load JSON data from file: {:?}", path))
    };

    json_loading_result.map_err(|e| {
        error!("Error loading JSON data from file: {:?}, {:?}", path, e);
        CliError::Processing(e)
    })
}

#[allow(clippy::too_many_arguments)]
async fn claim_settlement<'a>(
    program: &Program<Rc<DynSigner>>,
    rpc_client: Arc<RpcClient>,
    transaction_builder: &mut TransactionBuilder,
    transaction_executor: Arc<TransactionExecutor>,
    claimable_settlement: ClaimableSettlementsReturn,
    settlement_json_data: &'a JsonClaimSettlementRecord,
    settlement_claims: Vec<(Pubkey, bool)>,
    config_address: &Pubkey,
    rent_payer: &Pubkey,
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
    for (tree_node, (settlement_claim_address, settlement_claim_exists)) in settlement_json_data
        .tree_nodes
        .iter()
        .zip(settlement_claims.into_iter())
    {
        if settlement_claim_exists {
            debug!("Settlement claim {} already exists for tree node stake:{}/withdrawer:{}/claim:{}, settlement {}",
                    settlement_claim_address, tree_node.stake_authority, tree_node.withdraw_authority,
                    lamports_to_sol(tree_node.claim),
                    settlement_json_data.settlement_address);
            continue;
        }
        let proof = if let Some(proof) = tree_node.proof.clone() {
            proof
        } else {
            reporting.add_error_string(format!(
                "No proof found for tree node stake:{}/withdrawer:{}/claim:{}, settlement {}",
                tree_node.stake_authority,
                tree_node.withdraw_authority,
                lamports_to_sol(tree_node.claim),
                settlement_json_data.settlement_address
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
                    "No stake account found with enough SOLs to claim {} from, settlement {}, epoch {}",
                    lamports_to_sol(tree_node.claim),
                    settlement_json_data.settlement_address,
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
                "No available stake account found where to claim into of staker/withdraw authorities {}/{}: {:?}",
                tree_node.stake_authority, tree_node.withdraw_authority, e
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
            .accounts(validator_bonds::accounts::ClaimSettlement {
                config: *config_address,
                bond: settlement_json_data.bond_address,
                settlement: settlement_json_data.settlement_address,
                settlement_claim: settlement_claim_address,
                stake_account_from,
                stake_account_to,
                bonds_withdrawer_authority,
                stake_history: stake_history_id,
                stake_program: stake_program_id,
                rent_payer: *rent_payer,
                program: validator_bonds_id,
                system_program: system_program::ID,
                clock: clock_id,
                event_authority: find_event_authority().0,
            })
            .args(validator_bonds::instruction::ClaimSettlement {
                claim_settlement_args: ClaimSettlementArgs {
                    proof,
                    stake_account_staker: tree_node.stake_authority,
                    stake_account_withdrawer: tree_node.withdraw_authority,
                    claim: tree_node.claim,
                    tree_node_hash: get_tree_node_hash(tree_node),
                },
            });
        add_instruction_to_builder(
            transaction_builder,
            &req,
            format!(
                "Claim {} settlement {}, from {}, to {}",
                settlement_claim_address,
                settlement_json_data.settlement_address,
                stake_account_from,
                stake_account_to
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

fn get_tree_node_hash(tree_node: &TreeNode) -> [u8; 32] {
    let mut no_proof_tree_node = tree_node.clone();
    no_proof_tree_node.proof = None;
    no_proof_tree_node.hash().to_bytes()
}

struct MerkleTreeLoadedData {
    merkle_tree_collection: Option<MerkleTreeCollection>,
    settlement_collection: Option<SettlementCollection>,
}

fn insert_merkle_tree_loaded_data(
    loaded_data: &mut HashMap<u64, MerkleTreeLoadedData>,
    merkle_tree_collection: Option<MerkleTreeCollection>,
    settlement_collection: Option<SettlementCollection>,
) -> anyhow::Result<()> {
    // Get the epoch and handle mismatches
    let epoch = match (&merkle_tree_collection, &settlement_collection) {
        (Some(mc), Some(sc)) if mc.epoch != sc.epoch => {
            return Err(CliError::processing(format!(
                "Epoch mismatch between merkle tree collection and settlement collection: {} != {}",
                mc.epoch, sc.epoch
            )));
        }
        (Some(mc), _) => mc.epoch,
        (_, Some(sc)) => sc.epoch,
        _ => {
            return Err(CliError::processing(
                "No epoch found in either merkle tree collection or settlement collection",
            ));
        }
    };

    let record = loaded_data
        .entry(epoch)
        .or_insert_with(|| MerkleTreeLoadedData {
            merkle_tree_collection: None,
            settlement_collection: None,
        });
    if record.merkle_tree_collection.is_none() {
        record.merkle_tree_collection = merkle_tree_collection;
    }
    if record.settlement_collection.is_none() {
        record.settlement_collection = settlement_collection;
    }

    Ok(())
}

fn get_settlement_from_json<'a>(
    json_per_epoch_claim_records: &'a HashMap<u64, Vec<JsonClaimSettlementRecord>>,
    on_chain_settlement: &ClaimableSettlementsReturn,
) -> Result<&'a JsonClaimSettlementRecord, CliError> {
    let settlement_epoch = on_chain_settlement.settlement.epoch_created_for;
    let settlement_merkle_tree =
        if let Some(settlement_merkle_tree) = json_per_epoch_claim_records.get(&settlement_epoch) {
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

async fn get_existence_of_settlement_claims(
    rpc_client: Arc<RpcClient>,
    settlement_json_data: &JsonClaimSettlementRecord,
) -> Result<Vec<(Pubkey, bool)>, CliError> {
    let settlement_claim_addresses = settlement_json_data
        .tree_nodes
        .iter()
        .map(|tree_node| {
            let tree_node_hash = get_tree_node_hash(tree_node);
            find_settlement_claim_address(&settlement_json_data.settlement_address, &tree_node_hash)
                .0
        })
        .collect::<Vec<Pubkey>>();
    let settlement_claims = collect_existence_settlement_claims_from_addresses(
        rpc_client.clone(),
        &settlement_claim_addresses,
    )
    .await
    .map_err(|e| {
        CliError::Processing(anyhow!(
            "Error fetching settlement claim accounts for settlement {}: {:?}",
            settlement_json_data.settlement_address,
            e
        ))
    })?;
    assert_eq!(
        // we searched for all the settlement claims addresses available in json
        // all pubkeys should be present while account data is available only for subset
        settlement_json_data.tree_nodes.len(),
        settlement_claims.len()
    );
    Ok(settlement_claims)
}

#[derive(Debug, Clone)]
struct JsonClaimSettlementRecord {
    vote_account_address: Pubkey,
    bond_address: Pubkey,
    settlement_address: Pubkey,
    merkle_root: [u8; 32],
    tree_nodes: Vec<TreeNode>,
    max_total_claim_sum: u64,
}

impl JsonClaimSettlementRecord {
    fn load_as_vec_per_epoch(
        json_loaded_claiming_data: HashMap<u64, CombinedMerkleTreeSettlementCollections>,
        config_address: Pubkey,
        args_epoch: Option<u64>,
    ) -> HashMap<u64, Vec<JsonClaimSettlementRecord>> {
        json_loaded_claiming_data
            .into_iter()
            .map(|(epoch, combined_data)| {
                (
                    epoch,
                    combined_data
                        .merkle_tree_settlements
                        .into_iter()
                        .filter(|d| d.merkle_tree.merkle_root.is_some())
                        .map(|d| {
                            assert_eq!(epoch, args_epoch.unwrap_or(combined_data.epoch));
                            let merkle_root = d.merkle_tree.merkle_root.unwrap().to_bytes();
                            let (bond_address, _) =
                                find_bond_address(&config_address, &d.merkle_tree.vote_account);
                            let (settlement_address, _) =
                                find_settlement_address(&bond_address, &merkle_root, epoch);
                            JsonClaimSettlementRecord {
                                vote_account_address: d.merkle_tree.vote_account,
                                max_total_claim_sum: d.merkle_tree.max_total_claim_sum,
                                bond_address,
                                settlement_address,
                                merkle_root,
                                tree_nodes: d.merkle_tree.tree_nodes,
                            }
                        })
                        .collect::<Vec<_>>(),
                )
            })
            .collect::<HashMap<u64, Vec<JsonClaimSettlementRecord>>>()
    }
}

struct ClaimSettlementReport {
    rpc_client: Option<Arc<RpcClient>>,
    settlements_claimable_before: HashMap<Pubkey, ClaimSettlementReportData>,
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
                return vec![];
            };
            let claimable_settlements_addresses: Vec<Pubkey> =
                self.settlements_claimable_before.keys().copied().collect();
            sleep(std::time::Duration::from_secs(8)).await; // waiting for data finalization on-chain
            let settlements_claimable_after =
                get_settlements_for_pubkeys(rpc_client.clone(), &claimable_settlements_addresses)
                    .await;
            match settlements_claimable_after {
                Ok(settlements_claimable_after) => {
                    let settlement_claim_rent = rpc_client
                        .get_minimum_balance_for_rent_exemption(SETTLEMENT_CLAIM_ACCOUNT_SIZE)
                        .await
                        .map_or_else(
                            |e| {
                                error!("Error fetching SettlementClaim account rent: {:?}", e);
                                0_u64
                            },
                            |v| v,
                        );
                    let mut grouped_by_epoch: HashMap<_, Vec<_>> = HashMap::new();
                    for (pubkey, settlement) in settlements_claimable_after {
                        let epoch = settlement.as_ref().map_or(0, |s| s.epoch_created_for);
                        grouped_by_epoch
                            .entry(epoch)
                            .or_insert_with(Vec::new)
                            .push((pubkey, settlement));
                    }
                    let mut report: Vec<String> = vec![];
                    let mut claim_settlements_accounts_created: u64 = 0;
                    for epoch in grouped_by_epoch.keys() {
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
                            let claim_accounts_count_before = self
                                .settlements_claimable_before
                                .get(settlement_address)
                                .map_or_else(
                                    || None,
                                    |d| {
                                        Some(
                                            d.claim_records
                                                .values()
                                                .map(|v| v.map_or_else(|| 0_u64, |v| v))
                                                .sum::<u64>(),
                                        )
                                    },
                                );
                            let claim_accounts_count_after = get_settlement_claims_for_settlement(
                                rpc_client.clone(),
                                settlement_address,
                            )
                            .await
                            .map_or_else(
                                |e| {
                                    error!("Cannot report settlement claiming: {:?}", e);
                                    0_u64
                                },
                                |s| s.len() as u64,
                            );
                            let claim_accounts_count_diff = claim_accounts_count_after
                                .saturating_sub(
                                    claim_accounts_count_before.map_or_else(|| 0, |v| v),
                                );
                            claim_settlements_accounts_created += claim_accounts_count_diff;
                            epoch_report.push(format!(
                                "  Settlement {} in sum claimed SOLs {}/{} SOLs, ClaimSettlement accounts {}/{}. \n    This time claimed SOLs {}, ClaimSettlement accounts {} (not claimed reason: no target {}, no source: {})",
                                settlement_address,
                                lamports_to_sol(claimed_after),
                                lamports_to_sol(max_claimed),
                                claim_accounts_count_after,
                                max_nodes,
                                lamports_to_sol(claimed_diff),
                                claim_accounts_count_diff,
                                lamports_to_sol(*stake_account_to),
                                lamports_to_sol(*stake_account_from),
                            ));
                        }
                        report.push(format!(
                            "Epoch {}, this time created {} ClaimSettlement accounts in sum of rent {} SOL",
                            epoch,
                            claim_settlements_accounts_created,
                            lamports_to_sol(settlement_claim_rent * claim_settlements_accounts_created)
                        ));
                        report.extend(epoch_report);
                    }
                    report
                }
                Err(e) => {
                    vec![format!("Error reporting settlement claiming: {:?}", e)]
                }
            }
        })
    }
}

struct ClaimSettlementReportData {
    claim_records: HashMap<Pubkey, Option<u64>>,
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
        claimable_settlements: &Vec<ClaimableSettlementsReturn>,
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
                    ClaimSettlementReportData {
                        claim_records: HashMap::new(),
                    },
                )
            })
            .collect::<HashMap<Pubkey, ClaimSettlementReportData>>();
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

    /// Update claim records before claiming while returning the number of claimable accounts before the update
    fn update_claim_records_before(
        &mut self,
        settlement_address: &Pubkey,
        claim_records: &[(Pubkey, bool)],
    ) -> usize {
        let settlement_claim_account_count = claim_records.iter().filter(|(_, b)| *b).count();
        if let Some(s) = self
            .settlements_claimable_before
            .get_mut(settlement_address)
        {
            s.claim_records.insert(
                *settlement_address,
                Some(settlement_claim_account_count as u64),
            );
        }
        settlement_claim_account_count
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
