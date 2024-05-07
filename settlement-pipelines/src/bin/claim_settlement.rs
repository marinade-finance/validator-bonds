use anyhow::anyhow;
use clap::Parser;
use log::{debug, error, info};
use merkle_tree::psr_claim::TreeNode;
use settlement_engine::merkle_tree_collection::MerkleTreeCollection;
use settlement_engine::settlement_claims::SettlementCollection;
use settlement_engine::utils::read_from_json_file;
use settlement_pipelines::anchor::add_instructions_to_builder_from_anchor;
use settlement_pipelines::arguments::{
    init_from_opts, GlobalOpts, InitializedGlobalOpts, PriorityFeePolicyOpts, TipPolicyOpts,
};
use settlement_pipelines::init::init_log;
use settlement_pipelines::json_data::resolve_combined_optional;
use settlement_pipelines::settlements::list_claimable_settlements;
use settlement_pipelines::stake_accounts::pick_stake_for_claiming;
use settlement_pipelines::stake_accounts_cache::StakeAccountsCache;
use settlement_pipelines::STAKE_ACCOUNT_RENT_EXEMPTION;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::stake::program::ID as stake_program_id;
use solana_sdk::system_program;
use solana_sdk::sysvar::{clock::ID as clock_id, stake_history::ID as stake_history_id};
use solana_transaction_builder::TransactionBuilder;
use solana_transaction_builder_executor::{
    builder_to_execution_data, execute_transactions_in_parallel,
};
use solana_transaction_executor::{
    SendTransactionWithGrowingTipProvider, TransactionExecutorBuilder,
};
use std::collections::HashMap;
use std::io;
use std::path::PathBuf;
use std::sync::Arc;
use validator_bonds::instructions::ClaimSettlementArgs;
use validator_bonds::state::bond::find_bond_address;
use validator_bonds::state::config::{find_bonds_withdrawer_authority, Config};
use validator_bonds::state::settlement::find_settlement_address;
use validator_bonds::state::settlement_claim::find_settlement_claim_address;
use validator_bonds::ID as validator_bonds_id;
use validator_bonds_common::constants::find_event_authority;
use validator_bonds_common::settlement_claims::collect_existence_settlement_claims_from_addresses;
use validator_bonds_common::stake_accounts::{get_stake_history, CollectedStakeAccounts};
use validator_bonds_common::utils::get_sysvar_clock;

const SETTLEMENT_MERKLE_TREES_SUFFIX: &str = "settlement-merkle-trees.json";
const SETTLEMENTS_SUFFIX: &str = "settlements.json";

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[clap(flatten)]
    global_opts: GlobalOpts,

    #[arg(
        short = 'd',
        long,
        env,
        help = "Path to directory containing json files with tree collection files and settlement files"
    )]
    merkle_trees_dir: String,

    /// forcing epoch, overriding ones loaded from json files of merkle_trees_dir
    /// mostly useful for testing purposes
    #[arg(long)]
    epoch: Option<u64>,

    #[clap(flatten)]
    priority_fee_policy_opts: PriorityFeePolicyOpts,

    #[clap(flatten)]
    tip_policy_opts: TipPolicyOpts,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Args = Args::parse();
    init_log(&args.global_opts);

    let InitializedGlobalOpts {
        rpc_url,
        fee_payer_keypair,
        fee_payer_pubkey,
        operator_authority_keypair: _,
        priority_fee_policy,
        tip_policy,
        rpc_client,
        program,
    } = init_from_opts(
        &args.global_opts,
        &args.priority_fee_policy_opts,
        &args.tip_policy_opts,
    )?;

    let merkle_trees_dir = args.merkle_trees_dir.clone();
    let merkle_trees_dir = std::path::Path::new(&merkle_trees_dir);

    let mut json_data: HashMap<u64, MerkleTreeLoadedData> = HashMap::new();
    for path in merkle_trees_dir.read_dir()?.filter_map(|entry| {
        entry.ok().and_then(|e| {
            let path = e.path();
            debug!("Processing path: {:?}", path);
            if path.is_file() {
                Some(path)
            } else {
                None
            }
        })
    }) {
        process_merkle_trees_file(&path, &mut json_data, &args)?;
    }
    let claiming_data = json_data
        .into_iter()
        .map(|(epoch, data)| {
            Ok((
                args.epoch.unwrap_or(epoch),
                resolve_combined_optional(data.merkle_tree_collection, data.settlement_collection)?,
            ))
        })
        .collect::<anyhow::Result<HashMap<_, _>>>()?;
    info!(
        "Loaded json data for epochs: {:?}",
        claiming_data.keys().collect::<Vec<_>>()
    );

    let config_address = args.global_opts.config;
    info!(
        "Claiming settlements for validator-bonds config: {}",
        config_address
    );
    let config: Config = program.account(config_address).await.map_err(|e| {
        anyhow!(
            "Cannot load validator-bonds config account {}: {:?}",
            config_address,
            e
        )
    })?;
    let (bonds_withdrawer_authority, _) = find_bonds_withdrawer_authority(&config_address);
    let minimal_stake_lamports = config.minimum_stake_lamports + STAKE_ACCOUNT_RENT_EXEMPTION;

    let claiming_data = claiming_data
        .into_iter()
        .map(|(epoch, combined_data)| {
            (
                epoch,
                combined_data
                    .merkle_tree_settlements
                    .into_iter()
                    .filter(|d| d.merkle_tree.merkle_root.is_some())
                    .map(|d| {
                        assert_eq!(epoch, args.epoch.unwrap_or(combined_data.epoch));
                        let merkle_root = d.merkle_tree.merkle_root.unwrap().to_bytes();
                        let bond_address =
                            find_bond_address(&config_address, &d.merkle_tree.vote_account).0;
                        let settlement_address =
                            find_settlement_address(&bond_address, &merkle_root, epoch).0;
                        ClaimSettlementRecord {
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
        .collect::<HashMap<u64, Vec<ClaimSettlementRecord>>>();

    let claimable_settlements =
        list_claimable_settlements(&config_address, &config, rpc_client.clone()).await?;
    info!("Claimable settlements: {}", claimable_settlements.len());

    let mut claim_settlement_errors: Vec<String> = vec![];

    let mut transaction_builder = TransactionBuilder::limited(fee_payer_keypair.clone());

    let clock = get_sysvar_clock(rpc_client.clone()).await?;
    let stake_history = get_stake_history(rpc_client.clone()).await?;

    // Assigning for each settlement the merkle tree data
    let mut claimed_stake_amounts: HashMap<Pubkey, u64> = HashMap::new();
    let mut stake_accounts_to_cache = StakeAccountsCache::default();

    for claimable_settlement in claimable_settlements {
        let settlement_epoch = claimable_settlement.settlement.epoch_created_for;
        let settlement_merkle_tree =
            if let Some(settlement_merkle_tree) = claiming_data.get(&settlement_epoch) {
                settlement_merkle_tree
            } else {
                let error_msg = format!(
                    "No merkle tree data found for settlement epoch {} from dir {}",
                    settlement_epoch, args.merkle_trees_dir
                );
                error!("{}", error_msg);
                claim_settlement_errors.push(error_msg);
                continue;
            };

        // finding matching settlement from merkle tree json files that matches the epoch
        let matching_settlement = settlement_merkle_tree.iter().find(|settlement_from_json| {
            settlement_from_json.settlement_address == claimable_settlement.settlement_address
        });
        let matching_settlement = if let Some(settlement) = matching_settlement {
            settlement
        } else {
            let error_msg = format!(
                "No matching settlement found for settlement address {}, bond {} in epoch {}",
                claimable_settlement.settlement_address,
                claimable_settlement.settlement.bond,
                settlement_epoch
            );
            error!("{}", error_msg);
            claim_settlement_errors.push(error_msg);
            continue;
        };

        if claimable_settlement.settlement.max_total_claim
            != matching_settlement.max_total_claim_sum
            || claimable_settlement.settlement.merkle_root != matching_settlement.merkle_root
        {
            let error_msg = format!(
                "Mismatch between claimable settlement and settlement from json file for settlement address {}, bond {} in epoch {}",
                claimable_settlement.settlement_address,
                claimable_settlement.settlement.bond,
                settlement_epoch
            );
            error!("{}", error_msg);
            claim_settlement_errors.push(error_msg);
            continue;
        }
        if claimable_settlement.stake_accounts.is_empty() {
            let error_msg = format!(
                "No stake accounts found for settlement {}",
                claimable_settlement.settlement_address
            );
            error!("{}", error_msg);
            claim_settlement_errors.push(error_msg);
            continue;
        }

        // let's check existence of the claim
        let settlement_claim_addresses = matching_settlement
            .tree_nodes
            .iter()
            .map(|tree_node| {
                let tree_node_hash = get_tree_node_hash(tree_node);
                find_settlement_claim_address(
                    &matching_settlement.settlement_address,
                    &tree_node_hash,
                )
                .0
            })
            .collect::<Vec<Pubkey>>();
        let settlement_claims = collect_existence_settlement_claims_from_addresses(
            rpc_client.clone(),
            &settlement_claim_addresses,
        )
        .await
        .map_err(|e| {
            anyhow!(
                "Error fetching settlement claim accounts for settlement {}: {:?}",
                matching_settlement.settlement_address,
                e
            )
        })?;
        let already_claimed_count = settlement_claims.iter().filter(|(_, b)| *b).count();

        // let's claim it
        info!(
            "Claiming settlement {}, vote account {}, claim amount {}, for epoch {}, number of stake accounts: {}, already claimed: {}",
            claimable_settlement.settlement_address.clone(),
            matching_settlement.vote_account_address,
            matching_settlement.max_total_claim_sum,
            settlement_epoch,
            claimable_settlement.stake_accounts.len(),
            already_claimed_count,
        );
        assert_eq!(
            matching_settlement.tree_nodes.len(),
            settlement_claims.len()
        );
        for (tree_node, (settlement_claim_address, settlement_claim_exists)) in matching_settlement
            .tree_nodes
            .iter()
            .zip(settlement_claims.into_iter())
        {
            if settlement_claim_exists {
                debug!("Settlement claim {} already exists for tree node stake:{}/withdrawer:{}/claim:{} for settlement {}",
                    settlement_claim_address, tree_node.stake_authority, tree_node.withdraw_authority, tree_node.claim,
                    matching_settlement.settlement_address);
                continue;
            }
            let proof = if let Some(proof) = tree_node.proof.clone() {
                proof
            } else {
                let error_msg = format!(
                    "No proof found for tree node stake:{}/withdrawer:{}/claim:{} for settlement {}",
                    tree_node.stake_authority, tree_node.withdraw_authority, tree_node.claim,
                    matching_settlement.settlement_address
                );
                error!("{}", error_msg);
                claim_settlement_errors.push(error_msg);
                continue;
            };

            let stake_account_from = {
                let stake_account_from =
                    claimable_settlement
                        .stake_accounts
                        .iter()
                        .find(|(pubkey, lamports, _)| {
                            let utilized_lamports =
                                claimed_stake_amounts.entry(*pubkey).or_insert(0);
                            if *lamports - *utilized_lamports - minimal_stake_lamports
                                >= tree_node.claim
                            {
                                claimed_stake_amounts
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
                    let err_msg = format!(
                        "No stake account found with enough lamports for claim {} for settlement {}, epoch {}",
                        tree_node.claim,
                        matching_settlement.settlement_address,
                        settlement_epoch
                    );
                    error!("{}", err_msg);
                    claim_settlement_errors.push(err_msg);
                    continue;
                }
            };

            let empty_stake_acounts: CollectedStakeAccounts = vec![];
            let stake_accounts_to = stake_accounts_to_cache
                .get(
                    rpc_client.clone(),
                    &tree_node.withdraw_authority,
                    &tree_node.stake_authority,
                )
                .await
                .map_or_else(
                    |e| {
                        claim_settlement_errors.push(format!("{:?}", e));
                        &empty_stake_acounts
                    },
                    |v| v,
                );
            let stake_account_to = pick_stake_for_claiming(
                stake_accounts_to,
                &clock,
                &stake_history,
            ).map_or_else(|e| {
                let error_msg = format!(
                    "No available stake account for claiming of staker/withdraw authorities {}/{}: {}",
                    tree_node.stake_authority, tree_node.withdraw_authority, e
                );
                error!("{}", error_msg);
                claim_settlement_errors.push(error_msg);
                None
            }, |v| v);
            let stake_account_to: Pubkey = if let Some(stake_account_to) = stake_account_to {
                stake_account_to
            } else {
                // stake accounts for these authorities were not found in this or some prior run
                continue;
            };

            let req = program
                .request()
                .accounts(validator_bonds::accounts::ClaimSettlement {
                    config: config_address,
                    bond: matching_settlement.bond_address,
                    settlement: matching_settlement.settlement_address,
                    settlement_claim: settlement_claim_address,
                    stake_account_from,
                    stake_account_to,
                    bonds_withdrawer_authority,
                    stake_history: stake_history_id,
                    stake_program: stake_program_id,
                    rent_payer: fee_payer_pubkey,
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
            add_instructions_to_builder_from_anchor(&mut transaction_builder, &req)?;
        }
    }

    let transaction_executor_builder = TransactionExecutorBuilder::new()
        .with_default_providers(rpc_client.clone())
        .with_send_transaction_provider(SendTransactionWithGrowingTipProvider {
            rpc_url: rpc_url.clone(),
            query_param: "tip".into(),
            tip_policy,
        });
    let transaction_executor = Arc::new(transaction_executor_builder.build());
    let claim_ix_count = transaction_builder.instructions().len();
    let execution_data = builder_to_execution_data(
        rpc_url.clone(),
        &mut transaction_builder,
        Some(priority_fee_policy.clone()),
    );
    execute_transactions_in_parallel(
        transaction_executor.clone(),
        execution_data,
        Some(100_usize),
    )
    .await
    .unwrap_or_else(|e| {
        let error_msg = format!("Error executing claim settlement instructions: {:?}", e);
        error!("{}", error_msg);
        claim_settlement_errors.push(error_msg);
    });
    println!("ClaimSettlement instructions {} executed", claim_ix_count,);

    if !claim_settlement_errors.is_empty() {
        serde_json::to_writer(io::stdout(), &claim_settlement_errors)?;
        return Err(anyhow!(
            "{} errors during settlements claiming",
            claim_settlement_errors.len(),
        ));
    }

    Ok(())
}

fn get_tree_node_hash(tree_node: &TreeNode) -> [u8; 32] {
    let mut no_proof_tree_node = tree_node.clone();
    no_proof_tree_node.proof = None;
    no_proof_tree_node.hash().to_bytes()
}

fn process_merkle_trees_file(
    path: &PathBuf,
    loaded_data: &mut HashMap<u64, MerkleTreeLoadedData>,
    args: &Args,
) -> anyhow::Result<()> {
    let path_string = path
        .to_str()
        .ok_or_else(|| anyhow!("Could not convert path {:?} to string", path))?;
    // Handle different file types based on suffix
    if path_string.ends_with(SETTLEMENT_MERKLE_TREES_SUFFIX) {
        info!(
            "path: {:?} ends with {}",
            path, SETTLEMENT_MERKLE_TREES_SUFFIX
        );
        let merkle_tree_collection: MerkleTreeCollection = read_from_json_file(path_string)
            .map_err(|e| {
                anyhow!(
                    "Cannot read merkle tree collection from directory {} as file '{:?}': {:?}",
                    args.merkle_trees_dir.clone(),
                    path,
                    e
                )
            })?;
        insert_merkle_tree_loaded_data(loaded_data, Some(merkle_tree_collection), None)?;
    } else if path_string.ends_with(SETTLEMENTS_SUFFIX) {
        info!("path: {:?} ends with {}", path, SETTLEMENTS_SUFFIX);
        let settlement_collection: SettlementCollection = read_from_json_file(path_string)
            .map_err(|e| {
                anyhow!(
                    "Cannot read settlement collection from directory {} as file '{:?}': {:?}",
                    args.merkle_trees_dir.clone(),
                    path,
                    e
                )
            })?;
        insert_merkle_tree_loaded_data(loaded_data, None, Some(settlement_collection))?;
    }

    Ok(())
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
            return Err(anyhow!(
                "Epoch mismatch between merkle tree collection and settlement collection: {} != {}",
                mc.epoch,
                sc.epoch
            ));
        }
        (Some(mc), _) => mc.epoch,
        (_, Some(sc)) => sc.epoch,
        _ => {
            return Err(anyhow!(
                "No epoch found in either merkle tree collection or settlement collection"
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

#[derive(Debug)]
struct ClaimSettlementRecord {
    vote_account_address: Pubkey,
    bond_address: Pubkey,
    settlement_address: Pubkey,
    merkle_root: [u8; 32],
    tree_nodes: Vec<TreeNode>,
    max_total_claim_sum: u64,
}
