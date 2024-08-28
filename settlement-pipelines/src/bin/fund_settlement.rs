use anchor_client::anchor_lang::solana_program::native_token::lamports_to_sol;
use anchor_client::anchor_lang::solana_program::stake::state::{Authorized, Lockup, StakeStateV2};
use anchor_client::anchor_lang::solana_program::system_program;
use anchor_client::{DynSigner, Program};
use clap::Parser;
use log::{debug, error, info, warn};
use settlement_pipelines::anchor::add_instruction_to_builder;
use settlement_pipelines::arguments::{
    init_from_opts, InitializedGlobalOpts, PriorityFeePolicyOpts, TipPolicyOpts,
};
use settlement_pipelines::arguments::{load_keypair, GlobalOpts};
use settlement_pipelines::cli_result::{CliError, CliResult};
use settlement_pipelines::executor::execute_in_sequence;
use settlement_pipelines::init::{get_executor, init_log};
use settlement_pipelines::json_data::{load_json, load_json_with_on_chain};
use settlement_pipelines::reporting::{with_reporting, PrintReportable, ReportHandler};
use settlement_pipelines::settlement_data::{
    SettlementFunderMarinade, SettlementFunderType, SettlementFunderValidatorBond, SettlementRecord,
};
use settlement_pipelines::stake_accounts::{
    get_stake_state_type, prepare_merge_instructions, StakeAccountStateType,
    STAKE_ACCOUNT_RENT_EXEMPTION,
};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::clock::Clock;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::{Keypair, Signer};
use solana_sdk::stake::instruction::create_account as create_stake_account_instructions;
use solana_sdk::stake::program::ID as stake_program_id;
use solana_sdk::sysvar::{
    clock::ID as clock_sysvar_id, rent::ID as rent_sysvar_id,
    stake_history::ID as stake_history_sysvar_id,
};
use solana_transaction_builder::TransactionBuilder;
use solana_transaction_executor::{PriorityFeePolicy, TransactionExecutor};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use validator_bonds::state::config::{find_bonds_withdrawer_authority, Config};
use validator_bonds::ID as validator_bonds_id;
use validator_bonds_common::config::get_config;
use validator_bonds_common::constants::find_event_authority;
use validator_bonds_common::stake_accounts::{
    collect_stake_accounts, get_clock, get_stake_history, obtain_delegated_stake_accounts,
    obtain_funded_stake_accounts_for_settlement, CollectedStakeAccount, CollectedStakeAccounts,
};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[clap(flatten)]
    global_opts: GlobalOpts,

    /// Pairs of JSON files: 'settlement.json' and 'merkle_tree.json'
    /// There could be provided multiple pairs of JSON files (argument '-f' can be provided multiple times),
    /// while the program expects that one pair contains settlement and merkle tree data of the same event.
    #[arg(required = true, short = 'f', long, value_delimiter = ' ', num_args(2))]
    json_files: Vec<PathBuf>,

    /// forcing epoch, overriding from the settlement collection
    #[arg(long)]
    epoch: Option<u64>,

    #[clap(flatten)]
    priority_fee_policy_opts: PriorityFeePolicyOpts,

    #[clap(flatten)]
    tip_policy_opts: TipPolicyOpts,

    /// Marinade wallet that pays for Marinade type Settlements
    #[clap(long)]
    marinade_wallet: Option<String>,

    /// keypair payer for rent of accounts, if not provided, fee payer keypair is used
    #[arg(long)]
    rent_payer: Option<String>,
}

#[tokio::main]
async fn main() -> CliResult {
    let mut reporting = FundSettlementReport::report_handler();
    let result = real_main(&mut reporting).await;
    with_reporting::<FundSettlementReport>(&reporting, result).await
}

async fn real_main(reporting: &mut ReportHandler<FundSettlementReport>) -> anyhow::Result<()> {
    let args: Args = Args::parse();
    init_log(&args.global_opts);

    let InitializedGlobalOpts {
        fee_payer,
        operator_authority,
        priority_fee_policy,
        tip_policy,
        rpc_client,
        program,
    } = init_from_opts(
        &args.global_opts,
        &args.priority_fee_policy_opts,
        &args.tip_policy_opts,
    )?;

    let rent_payer = if let Some(rent_payer) = args.rent_payer.clone() {
        load_keypair("--rent-payer", &rent_payer)?
    } else {
        fee_payer.clone()
    };
    let marinade_wallet = if let Some(marinade_wallet) = args.marinade_wallet.clone() {
        load_keypair("--marinade-wallet", &marinade_wallet)?
    } else {
        fee_payer.clone()
    };

    let config_address = args.global_opts.config;
    info!(
        "Funding settlements of validator-bonds config: {}",
        config_address
    );

    let config = get_config(rpc_client.clone(), config_address)
        .await
        .map_err(CliError::retry_able)?;

    let mut json_data = load_json(&args.json_files)?;
    let mut settlement_records_per_epoch = load_json_with_on_chain(
        rpc_client.clone(),
        &mut json_data,
        &config_address,
        args.epoch,
    )
    .await?;

    let transaction_executor = get_executor(rpc_client.clone(), tip_policy);

    reporting
        .reportable
        .init(rpc_client.clone(), &settlement_records_per_epoch);

    prepare_funding(
        &program,
        rpc_client.clone(),
        transaction_executor.clone(),
        &mut settlement_records_per_epoch,
        &config_address,
        &config,
        fee_payer.clone(),
        operator_authority.clone(),
        &priority_fee_policy,
        reporting,
    )
    .await?;

    fund_settlements(
        &program,
        rpc_client.clone(),
        transaction_executor.clone(),
        &settlement_records_per_epoch,
        &config_address,
        &config,
        fee_payer.clone(),
        operator_authority.clone(),
        marinade_wallet.clone(),
        rent_payer.clone(),
        &priority_fee_policy,
        reporting,
    )
    .await?;

    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn prepare_funding(
    program: &Program<Arc<DynSigner>>,
    rpc_client: Arc<RpcClient>,
    transaction_executor: Arc<TransactionExecutor>,
    settlement_records: &mut HashMap<u64, Vec<SettlementRecord>>,
    config_address: &Pubkey,
    config: &Config,
    fee_payer: Arc<Keypair>,
    operator_authority: Arc<Keypair>,
    priority_fee_policy: &PriorityFeePolicy,
    reporting: &mut ReportHandler<FundSettlementReport>,
) -> anyhow::Result<()> {
    let mut transaction_builder = TransactionBuilder::limited(fee_payer.clone());
    transaction_builder.add_signer_checked(&operator_authority);
    let (withdrawer_authority, _) = find_bonds_withdrawer_authority(config_address);
    let all_stake_accounts =
        collect_stake_accounts(rpc_client.clone(), Some(&withdrawer_authority), None)
            .await
            .map_err(CliError::retry_able)?;

    let clock = get_clock(rpc_client.clone())
        .await
        .map_err(CliError::retry_able)?;
    let stake_history = get_stake_history(rpc_client.clone())
        .await
        .map_err(CliError::retry_able)?;
    let minimal_stake_lamports = config.minimum_stake_lamports + STAKE_ACCOUNT_RENT_EXEMPTION;

    let mut fund_bond_stake_accounts =
        get_on_chain_bond_stake_accounts(&all_stake_accounts, &withdrawer_authority, &clock)
            .await?;

    let settlement_addresses: Vec<Pubkey> = settlement_records
        .iter()
        .flat_map(|(_, d)| d.iter().map(|s| s.settlement_address))
        .collect();
    let funded_to_settlement_stakes = obtain_funded_stake_accounts_for_settlement(
        all_stake_accounts,
        config_address,
        settlement_addresses,
        &clock,
        &stake_history,
    )
    .await
    .map_err(CliError::retry_able)?;

    // Merging stake accounts to fit for validator bonds funding
    for settlement_record in settlement_records
        .iter_mut()
        .flat_map(|(_, r)| r.iter_mut())
    {
        let epoch = settlement_record.epoch;

        if settlement_record.settlement_account.is_none() {
            reporting.add_error_string(format!(
                "Settlement {} (vote account {}, bond {}, epoch {}, reason {}) does not exist on-chain, cannot be funded",
                settlement_record.settlement_address,
                settlement_record.vote_account_address,
                settlement_record.bond_address,
                epoch,
                settlement_record.reason,
            ));
            continue;
        }
        if epoch + config.epochs_to_claim_settlement < clock.epoch {
            warn!(
                "Settlement {} (vote account {}, bond {}, epoch {}, reason {}) is too old to be funded, skipping funding",
                settlement_record.settlement_address,
                settlement_record.vote_account_address,
                settlement_record.bond_address,
                epoch,
                settlement_record.reason,
            );
            continue;
        }
        if settlement_record.bond_account.is_none() {
            reporting.add_error_string(format!(
                "Settlement {} (vote account {}, bond {}, epoch {}, reason {}) is not funded by validator bond, skipping funding",
                settlement_record.settlement_address,
                settlement_record.vote_account_address,
                settlement_record.bond_address,
                epoch,
                settlement_record.reason,
            ));
            reporting
                .reportable
                .mut_ref(epoch)
                .not_funded_by_validator_bond_count += 1;
            continue;
        }

        let settlement_amount_funded = funded_to_settlement_stakes
            .get(&settlement_record.settlement_address)
            .map_or(0, |(lamports_in_accounts, _)| *lamports_in_accounts);
        let amount_to_fund = settlement_record.settlement_account.as_ref().map_or(
            settlement_record.max_total_claim_sum,
            |settlement| {
                settlement
                    .max_total_claim
                    .saturating_sub(settlement.lamports_claimed)
                    .saturating_sub(settlement_amount_funded)
            },
        );

        if amount_to_fund == 0 {
            info!(
                "Settlement {} (vote account {}, epoch {}, funder {:?}) already funded by {}, skipping funding",
                settlement_record.settlement_address,
                settlement_record.vote_account_address,
                settlement_record.epoch,
                settlement_record.funder,
                lamports_to_sol(settlement_amount_funded),
            );
            reporting
                .reportable
                .mut_ref(epoch)
                .funded_settlements_count_before += 1;
            reporting.reportable.mut_ref(epoch).funded_amount_before +=
                settlement_record.max_total_claim_sum;
            continue;
        }

        match &mut settlement_record.funder {
            SettlementFunderType::Marinade(_) => {
                info!(
                    "Settlement {} (vote account {}, bond {}, reason {}, epoch {}) is to be funded by Marinade from fee wallet by {} SOLs",
                    settlement_record.settlement_address,
                    settlement_record.vote_account_address,
                    settlement_record.bond_address,
                    settlement_record.reason,
                    epoch,
                    lamports_to_sol(amount_to_fund)
                );
                info!(
                    "Max total claim: {}, lamports in stake: {:?}",
                    lamports_to_sol(settlement_record.max_total_claim_sum),
                    funded_to_settlement_stakes.get(&settlement_record.settlement_address)
                );
                settlement_record.funder =
                    SettlementFunderType::Marinade(Some(SettlementFunderMarinade {
                        amount_to_fund,
                    }));
                reporting.reportable.mut_ref(epoch).funded_amount += amount_to_fund;
            }
            SettlementFunderType::ValidatorBond(validator_bonds_funders) => {
                let mut empty_vec: Vec<FundBondStakeAccount> = vec![];
                let funding_stake_accounts = fund_bond_stake_accounts
                    .get_mut(&settlement_record.vote_account_address)
                    .unwrap_or(&mut empty_vec);
                // using the bigger stake accounts first
                funding_stake_accounts.sort_by_cached_key(|s| s.lamports);
                funding_stake_accounts.reverse();
                info!(
                        "Settlement {} (vote account {}, bond {}, reason {}, epoch {}) is to be funded by validator by {} SOLs. Available {} stake accounts ({}) with {} SOLs.",
                        settlement_record.settlement_address,
                        settlement_record.vote_account_address,
                        settlement_record.bond_address,
                        settlement_record.reason,
                        epoch,
                        lamports_to_sol(amount_to_fund),
                        funding_stake_accounts.len(),
                    funding_stake_accounts
                        .iter()
                        .map(|s| s.stake_account.to_string())
                        .collect::<Vec<String>>()
                        .join(","),
                        lamports_to_sol(funding_stake_accounts
                        .iter()
                        .map(|s| s.lamports)
                        .sum::<u64>())
                    );
                let mut lamports_available: u64 = 0;
                let mut stake_accounts_to_fund: Vec<FundBondStakeAccount> = vec![];
                funding_stake_accounts.retain(|stake_account| {
                    if lamports_available < amount_to_fund + minimal_stake_lamports {
                        lamports_available += stake_account.lamports;
                        stake_accounts_to_fund.push(stake_account.clone());
                        true // delete from the list, no available anymore, it will be funded
                    } else {
                        false // do not delete, it can be used for other settlement
                    }
                });

                // for the found and fitting stake accounts: taking first one and trying to merge other ones into it
                let stake_account_to_fund: Option<(FundBondStakeAccount, StakeAccountStateType)> =
                    if stake_accounts_to_fund.is_empty() || lamports_available == 0 {
                        None
                    } else {
                        let account = stake_accounts_to_fund.remove(0);
                        let stake_type =
                            get_stake_state_type(&account.state, &clock, &stake_history);
                        Some((account, stake_type))
                    };
                if let Some((
                    FundBondStakeAccount {
                        stake_account: destination_stake,
                        split_stake_account: destination_split_stake,
                        state: destination_stake_state,
                        lamports: destination_lamports,
                        ..
                    },
                    destination_stake_state_type,
                )) = stake_account_to_fund
                {
                    info!(
                        "Settlement: {} will be funded with {} stake accounts with {} SOLs, possibly merged into {}",
                        settlement_record.settlement_address,
                        funding_stake_accounts.len() + 1,
                        lamports_to_sol(
                            destination_lamports + stake_accounts_to_fund
                                .iter()
                                .map(|s| s.lamports)
                                .sum::<u64>()
                        ),
                        destination_stake
                    );
                    validator_bonds_funders.push(SettlementFunderValidatorBond {
                        stake_account_to_fund: destination_stake,
                    });

                    let possible_to_merge = stake_accounts_to_fund
                        .iter()
                        .map(|f| f.into())
                        .collect::<Vec<CollectedStakeAccount>>();
                    // when possible to merge then merge transactions are added to the transaction builder
                    // when non-mergeable stake account is found, it is directly funded to settlement
                    let non_mergeable = prepare_merge_instructions(
                        possible_to_merge.iter().collect(),
                        destination_stake,
                        destination_stake_state_type,
                        &settlement_record.settlement_address,
                        Some(&settlement_record.vote_account_address),
                        program,
                        config_address,
                        &withdrawer_authority,
                        &mut transaction_builder,
                        &clock,
                        &stake_history,
                    )
                    .await?;
                    validator_bonds_funders.extend(non_mergeable.into_iter().map(
                        |stake_account_address| SettlementFunderValidatorBond {
                            stake_account_to_fund: stake_account_address,
                        },
                    ));

                    match lamports_available.cmp(&(amount_to_fund + minimal_stake_lamports)) {
                        Ordering::Less => {
                            let err_msg = format!(
                                "Cannot fully fund settlement {} (vote account {}, epoch {}, reason: {}, funder: ValidatorBond). To fund {} SOLs, to fund with min stake amount {}, only {} SOLs were found in stake accounts",
                                settlement_record.settlement_address,
                                settlement_record.vote_account_address,
                                epoch,
                                settlement_record.reason,
                                lamports_to_sol(amount_to_fund),
                                lamports_to_sol(amount_to_fund + minimal_stake_lamports),
                                lamports_to_sol(lamports_available)
                            );
                            reporting.add_error_string(err_msg);
                            reporting.reportable.mut_ref(epoch).funded_amount += lamports_available;
                        }
                        Ordering::Equal => {
                            // fully funded and whole stake account is used for the settlement funding
                            reporting.reportable.mut_ref(epoch).funded_amount += amount_to_fund;
                        }
                        Ordering::Greater => {
                            // the stake account has got (or having after merging) more lamports than needed for the settlement in the current for-loop,
                            // the rest of lamports will be available in the split stake account
                            // and that can be used as a source for funding of next settlement when vote account is part of multiple settlements
                            // WARN: this REQUIRES that the merge stake transactions are executed in sequence!
                            let lamports_available_after_split = lamports_available
                                .saturating_sub(amount_to_fund)
                                .saturating_sub(minimal_stake_lamports);
                            // the funding_stake_accounts vec is mut ref item from fund_bond_stake_accounts hashmap
                            funding_stake_accounts.push(FundBondStakeAccount {
                                lamports: lamports_available_after_split,
                                stake_account: destination_split_stake.pubkey(),
                                split_stake_account: Arc::new(Keypair::new()),
                                state: destination_stake_state,
                            });
                            reporting.reportable.mut_ref(epoch).funded_amount += amount_to_fund;
                        }
                    }
                } else {
                    reporting.add_error_string(format!(
                        "Settlement {} (vote account {}, epoch {}, reason: {}, funder: ValidatorBond) not funded as no stake account available",
                        settlement_record.settlement_address,
                        settlement_record.vote_account_address,
                        epoch,
                        settlement_record.reason,
                    ));
                }
                // we've got to place in code where we wanted to fund something
                // it does not matter if it was successful or not (e.g., no stake account is available)
                // we need to track how much was funded before this, the calculated 'amount_to_fund'
                // reflects on how much is already funded, when subtracted from `max_total_claim_sum` then we get what has been already funded
                reporting.reportable.mut_ref(epoch).funded_amount_before += settlement_record
                    .max_total_claim_sum
                    .saturating_sub(amount_to_fund);
            }
        }
    }

    let execution_result = execute_in_sequence(
        rpc_client.clone(),
        transaction_executor.clone(),
        &mut transaction_builder,
        priority_fee_policy,
    )
    .await;
    reporting.add_tx_execution_result(execution_result, "Fund Settlement - Merge Stake Accounts");

    Ok(())
}

fn is_for_funding(settlement_record: &SettlementRecord) -> bool {
    match &settlement_record.funder {
        SettlementFunderType::Marinade(data) => {
            if let Some(SettlementFunderMarinade { amount_to_fund }) = data {
                *amount_to_fund > 0
            } else {
                false
            }
        }
        SettlementFunderType::ValidatorBond(data) => data.iter().any(
            |SettlementFunderValidatorBond {
                 stake_account_to_fund,
             }| *stake_account_to_fund != Pubkey::default(),
        ),
    }
}

#[allow(clippy::too_many_arguments)]
async fn fund_settlements(
    program: &Program<Arc<DynSigner>>,
    rpc_client: Arc<RpcClient>,
    transaction_executor: Arc<TransactionExecutor>,
    settlement_records: &HashMap<u64, Vec<SettlementRecord>>,
    config_address: &Pubkey,
    config: &Config,
    fee_payer: Arc<Keypair>,
    operator_authority: Arc<Keypair>,
    marinade_wallet: Arc<Keypair>,
    rent_payer: Arc<Keypair>,
    priority_fee_policy: &PriorityFeePolicy,
    reporting: &mut ReportHandler<FundSettlementReport>,
) -> anyhow::Result<()> {
    let mut transaction_builder = TransactionBuilder::limited(fee_payer.clone());
    transaction_builder.add_signer_checked(&operator_authority);
    transaction_builder.add_signer_checked(&rent_payer);
    transaction_builder.add_signer_checked(&marinade_wallet);

    let (withdrawer_authority, _) = find_bonds_withdrawer_authority(config_address);
    let minimal_stake_lamports = config.minimum_stake_lamports + STAKE_ACCOUNT_RENT_EXEMPTION;

    // WARN: the prior processing REQUIRES that the fund bond transactions are executed in sequence (execute_in_sequence)
    //       Funding works with ordered stake accounts where one stake account can be used for multiple settlements
    //       and number of available SOLs needs to be reduced one by one in the planned order

    for settlement_record in settlement_records.iter().flat_map(|(_, r)| r.iter()) {
        if !is_for_funding(settlement_record) {
            debug!(
                "Settlement {} (vote account {}, bond {}, epoch {}, reason: {}, funder {:?}) is not planned for funding",
                settlement_record.settlement_address,
                settlement_record.vote_account_address,
                settlement_record.bond_address,
                settlement_record.epoch,
                settlement_record.reason,
                settlement_record.funder
            );
            continue;
        }
        match &settlement_record.funder {
            SettlementFunderType::Marinade(Some(SettlementFunderMarinade { amount_to_fund })) => {
                let new_stake_account_keypair = Arc::new(Keypair::new());
                transaction_builder.add_signer_checked(&new_stake_account_keypair);
                info!(
                    "Settlement: {} (vote account {}, bond {}, epoch {}, reason: {}, funder: {}), creating Marinade stake account {}",
                    settlement_record.settlement_address,
                    settlement_record.vote_account_address,
                    settlement_record.bond_address,
                    settlement_record.epoch,
                    settlement_record.reason,
                    settlement_record.funder,
                    new_stake_account_keypair.pubkey()
                );
                let instructions = create_stake_account_instructions(
                    &marinade_wallet.pubkey(),
                    &new_stake_account_keypair.pubkey(),
                    &Authorized {
                        withdrawer: withdrawer_authority,
                        staker: settlement_record.settlement_staker_authority,
                    },
                    &Lockup {
                        unix_timestamp: 0,
                        epoch: 0,
                        custodian: withdrawer_authority,
                    },
                    // after claiming the rest has to be still living stake account
                    amount_to_fund + minimal_stake_lamports,
                );
                transaction_builder.add_instructions(instructions)?;
                transaction_builder.finish_instruction_pack();
                reporting
                    .reportable
                    .add_funded_settlement(settlement_record);
            }
            SettlementFunderType::ValidatorBond(validator_bonds_funders) => {
                for SettlementFunderValidatorBond {
                    stake_account_to_fund,
                    ..
                } in validator_bonds_funders
                {
                    // Settlement funding could be of two types: from validator bond or from operator wallet
                    let split_stake_account_keypair = Arc::new(Keypair::new());
                    let req = program
                        .request()
                        .accounts(validator_bonds::accounts::FundSettlement {
                            config: *config_address,
                            bond: settlement_record.bond_address,
                            stake_account: *stake_account_to_fund,
                            bonds_withdrawer_authority: withdrawer_authority,
                            operator_authority: operator_authority.pubkey(),
                            settlement: settlement_record.settlement_address,
                            system_program: system_program::ID,
                            settlement_staker_authority: settlement_record
                                .settlement_staker_authority,
                            rent: rent_sysvar_id,
                            split_stake_account: split_stake_account_keypair.pubkey(),
                            split_stake_rent_payer: rent_payer.pubkey(),
                            stake_history: stake_history_sysvar_id,
                            clock: clock_sysvar_id,
                            stake_program: stake_program_id,
                            program: validator_bonds_id,
                            event_authority: find_event_authority().0,
                        })
                        .args(validator_bonds::instruction::FundSettlement {});
                    transaction_builder.add_signer_checked(&split_stake_account_keypair);
                    add_instruction_to_builder(
                        &mut transaction_builder,
                        &req,
                        format!(
                            "FundSettlement: {}, bond: {}, reason: {}, stake: {}",
                            settlement_record.settlement_address,
                            settlement_record.bond_address,
                            settlement_record.reason,
                            stake_account_to_fund,
                        ),
                    )?;
                    reporting
                        .reportable
                        .add_funded_settlement(settlement_record);
                }
            }
            _ => {
                // reason should be already part of report and we don't want to double-add
                error!(
                    "Not possible to fund settlement {} (vote account {}, bond {}, epoch {}, reason {}, funder {:?})",
                    settlement_record.settlement_address,
                    settlement_record.vote_account_address,
                    settlement_record.bond_address,
                    settlement_record.epoch,
                    settlement_record.reason,
                    settlement_record.funder
                );
            }
        }
    }

    let execute_result = execute_in_sequence(
        rpc_client.clone(),
        transaction_executor.clone(),
        &mut transaction_builder,
        priority_fee_policy,
    )
    .await;
    reporting.add_tx_execution_result(execute_result, "FundSettlements");

    Ok(())
}

#[derive(Clone)]
struct FundBondStakeAccount {
    lamports: u64,
    stake_account: Pubkey,
    split_stake_account: Arc<Keypair>,
    state: StakeStateV2,
}

impl From<&FundBondStakeAccount> for CollectedStakeAccount {
    fn from(fund_bond_stake_account: &FundBondStakeAccount) -> Self {
        (
            fund_bond_stake_account.stake_account,
            fund_bond_stake_account.lamports,
            fund_bond_stake_account.state,
        )
    }
}

/// Filtering stake accounts and creating a Map of vote account to stake accounts
async fn get_on_chain_bond_stake_accounts(
    stake_accounts: &CollectedStakeAccounts,
    withdrawer_authority: &Pubkey,
    clock: &Clock,
) -> Result<HashMap<Pubkey, Vec<FundBondStakeAccount>>, CliError> {
    let non_funded: CollectedStakeAccounts = stake_accounts
        .clone()
        .into_iter()
        .filter(|(_, _, stake)| {
            if let Some(authorized) = stake.authorized() {
                authorized.staker == *withdrawer_authority
                    && authorized.withdrawer == *withdrawer_authority
            } else {
                false
            }
        })
        .collect();

    let non_funded_delegated_stakes = obtain_delegated_stake_accounts(non_funded, clock)
        .await
        .map_err(CliError::RetryAble)?;

    // creating a map of vote account to stake accounts
    let result_map = non_funded_delegated_stakes
        .into_iter()
        .map(|(vote_account, stake_accounts)| {
            (
                vote_account,
                stake_accounts
                    .into_iter()
                    .map(|(stake_account, lamports, state)| FundBondStakeAccount {
                        lamports,
                        stake_account,
                        split_stake_account: Arc::new(Keypair::new()),
                        state,
                    })
                    .collect(),
            )
        })
        .collect::<HashMap<Pubkey, Vec<FundBondStakeAccount>>>();
    Ok(result_map)
}

struct FundSettlementReport {
    rpc_client: Option<Arc<RpcClient>>,
    funded_data_per_epoch: HashMap<u64, FundedReportingData>,
}

#[derive(Default)]
struct FundedReportingData {
    json_settlements_count: u64,
    json_settlements_max_claim_sum: u64,
    funded_amount: u64,
    funded_settlements: HashSet<Pubkey>,
    funded_amount_before: u64,
    funded_settlements_count_before: u64,
    not_funded_by_validator_bond_count: u64,
}

impl PrintReportable for FundSettlementReport {
    fn get_report(&self) -> Pin<Box<dyn Future<Output = Vec<String>> + '_>> {
        Box::pin(async {
            let _rpc_client = if let Some(rpc_client) = &self.rpc_client {
                rpc_client
            } else {
                return vec![];
            };
            let mut report = vec![];
            let mut sorted_by_epoch = self
                .funded_data_per_epoch
                .iter()
                .collect::<Vec<(&u64, &FundedReportingData)>>();
            sorted_by_epoch.sort_by_key(|(a, _)| *a);
            for (epoch, funded_data) in sorted_by_epoch {
                report.push(format!(
                    "Epoch {} funded {}/{} settlements with {}/{} SOLs (before this already funded {}/{} settlements with {}/{} SOLs)",
                    epoch,
                    funded_data.funded_settlements.len(),
                    funded_data.json_settlements_count,
                    lamports_to_sol(funded_data.funded_amount),
                    lamports_to_sol(funded_data.json_settlements_max_claim_sum),
                    funded_data.funded_settlements_count_before,
                    funded_data.json_settlements_count,
                    lamports_to_sol(funded_data.funded_amount_before),
                    lamports_to_sol(funded_data.json_settlements_max_claim_sum),
                ));
                if funded_data.not_funded_by_validator_bond_count > 0 {
                    report.push(format!(
                        "    Number of Settlements not funded because of non-existing Bond: {}",
                        funded_data.not_funded_by_validator_bond_count
                    ));
                }
            }
            report
        })
    }
}

impl FundSettlementReport {
    fn report_handler() -> ReportHandler<Self> {
        let fund_settlement_report = Self {
            rpc_client: None,
            funded_data_per_epoch: HashMap::new(),
        };
        ReportHandler::new(fund_settlement_report)
    }

    fn init(
        &mut self,
        rpc_client: Arc<RpcClient>,
        json_data: &HashMap<u64, Vec<SettlementRecord>>,
    ) {
        self.rpc_client = Some(rpc_client);
        for (epoch, record) in json_data {
            self.funded_data_per_epoch.insert(
                *epoch,
                FundedReportingData {
                    json_settlements_count: record.len() as u64,
                    json_settlements_max_claim_sum: record
                        .iter()
                        .map(|s| s.max_total_claim_sum)
                        .sum::<u64>(),
                    ..Default::default()
                },
            );
        }
    }

    fn add_funded_settlement(&mut self, record: &SettlementRecord) {
        self.funded_data_per_epoch
            .entry(record.epoch)
            .or_default()
            .funded_settlements
            .insert(record.settlement_address);
    }
    fn mut_ref(&mut self, epoch: u64) -> &mut FundedReportingData {
        self.funded_data_per_epoch.entry(epoch).or_default()
    }
}
