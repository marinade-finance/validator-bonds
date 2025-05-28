use anchor_client::anchor_lang::solana_program::native_token::lamports_to_sol;
use anchor_client::anchor_lang::solana_program::stake::state::{Authorized, Lockup, StakeStateV2};
use anchor_client::anchor_lang::solana_program::system_program;
use anchor_client::{DynSigner, Program};
use clap::Parser;
use log::{debug, error, info};
use settlement_pipelines::anchor::add_instruction_to_builder;
use settlement_pipelines::arguments::{
    init_from_opts, InitializedGlobalOpts, PriorityFeePolicyOpts, TipPolicyOpts,
};
use settlement_pipelines::arguments::{load_keypair, GlobalOpts};
use settlement_pipelines::cli_result::{CliError, CliResult};
use settlement_pipelines::executor::execute_in_sequence;
use settlement_pipelines::init::{get_executor, init_log};
use settlement_pipelines::institutional_validators::{fetch_validator_data, ValidatorsData};
use settlement_pipelines::json_data::{load_json, load_json_with_on_chain};
use settlement_pipelines::reporting::ErrorEntry::{Generic, VoteAccount};
use settlement_pipelines::reporting::{
    with_reporting, ErrorEntry, ErrorSeverity, PrintReportable, ReportHandler,
};
use settlement_pipelines::reporting_data::{ReportingReasonSettlement, SettlementsReportData};
use settlement_pipelines::settlement_data::{
    SettlementFunderMarinade, SettlementFunderType, SettlementFunderValidatorBond, SettlementRecord,
};
use settlement_pipelines::stake_accounts::{
    get_delegated_amount, get_stake_state_type, prepare_merge_instructions, StakeAccountStateType,
    STAKE_ACCOUNT_RENT_EXEMPTION,
};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::clock::Clock;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::{Keypair, Signer};
use solana_sdk::stake::config::ID as stake_config_id;
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
    let mut reporting = FundSettlementsReport::report_handler();
    let result = real_main(&mut reporting).await;
    with_reporting::<FundSettlementsReport>(&mut reporting, result).await
}

async fn real_main(reporting: &mut ReportHandler<FundSettlementsReport>) -> anyhow::Result<()> {
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
        .init(
            &settlement_records_per_epoch,
            args.global_opts.institutional_url,
        )
        .await;

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
    reporting: &mut ReportHandler<FundSettlementsReport>,
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
            reporting.error().with_msg(format!(
                "Settlement {} (vote account {}, bond {}, epoch {}, reason {}) does not exist on-chain, cannot be funded",
                settlement_record.settlement_address,
                settlement_record.vote_account_address,
                settlement_record.bond_address,
                epoch,
                settlement_record.reason,
            )).with_vote(settlement_record.vote_account_address).add();
            continue;
        }
        if epoch + config.epochs_to_claim_settlement < clock.epoch {
            reporting.warning().with_msg(format!(
                "Settlement {} (vote account {}, bond {}, epoch {}, reason {}) is too old to be funded, skipping funding",
                settlement_record.settlement_address,
                settlement_record.vote_account_address,
                settlement_record.bond_address,
                epoch,
                settlement_record.reason,
            )).with_vote(settlement_record.vote_account_address).add();
            continue;
        }
        if settlement_record.bond_account.is_none() {
            reporting.error().with_msg(format!(
                "Settlement {} (vote account {}, bond {}, epoch {}, reason {}) funding skipped. Bond account does not exist.",
                settlement_record.settlement_address,
                settlement_record.vote_account_address,
                settlement_record.bond_address,
                epoch,
                settlement_record.reason,
            )).with_vote(settlement_record.vote_account_address).add();
            reporting
                .reportable
                .mut_ref(epoch)
                .not_funded_by_validator_bond_count += 1;
            continue;
        }

        let settlement_amount_funded = funded_to_settlement_stakes
            .get(&settlement_record.settlement_address)
            .map_or(0, |(lamports_in_accounts, funded_accounts)|
                // Amount funded has to be calculated without the minimal stake amount that is not part of the claim
                *lamports_in_accounts - (funded_accounts.len() as u64 * minimal_stake_lamports));
        let amount_to_fund = settlement_record.settlement_account.as_ref().map_or(
            settlement_record.max_total_claim_sum,
            |settlement| {
                assert_eq!(
                    settlement.max_total_claim,
                    settlement_record.max_total_claim_sum,
                );
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
                .add_already_fully_funded_settlement(settlement_record);
            continue;
        }

        match &mut settlement_record.funder {
            SettlementFunderType::Marinade(_) => {
                info!(
                    "Settlement {} (vote account {}, bond {}, reason {}, max claim {} SOLs, epoch {}) is to be funded by Marinade from fee wallet by {} SOLs",
                    settlement_record.settlement_address,
                    settlement_record.vote_account_address,
                    settlement_record.bond_address,
                    settlement_record.reason,
                    lamports_to_sol(settlement_record.max_total_claim_sum),
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
                reporting
                    .reportable
                    .add_funded_settlement(settlement_record, amount_to_fund);
            }
            SettlementFunderType::ValidatorBond(validator_bonds_funders) => {
                let mut empty_vec: Vec<FundBondStakeAccount> = vec![];
                let funding_stake_accounts = fund_bond_stake_accounts
                    .get_mut(&settlement_record.vote_account_address)
                    .unwrap_or(&mut empty_vec);
                // prioritize the biggest undelegated (inactive) amounts first
                funding_stake_accounts.sort_by_cached_key(|account| {
                    let delegated_amount =
                        get_delegated_amount(&account.state, &clock, &stake_history);
                    account.lamports.saturating_sub(delegated_amount)
                });
                funding_stake_accounts.reverse();
                info!(
                        "Settlement {} (vote account {}, bond {}, reason {}, max claim {} SOLS, epoch {}) is to be funded by validator by {} SOLs. Available {} stake accounts ({}) with {} SOLs.",
                        settlement_record.settlement_address,
                        settlement_record.vote_account_address,
                        settlement_record.bond_address,
                        settlement_record.reason,
                        lamports_to_sol(settlement_record.max_total_claim_sum),
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
                let mut funding_lamports_accumulated: u64 = 0;
                let mut stake_accounts_to_fund: Vec<FundBondStakeAccount> = vec![];
                funding_stake_accounts.retain(|stake_account| {
                    if funding_lamports_accumulated < amount_to_fund + minimal_stake_lamports {
                        funding_lamports_accumulated += stake_account.lamports;
                        stake_accounts_to_fund.push(stake_account.clone());
                        true // delete from the list, no available anymore, it will be funded
                    } else {
                        false // do not delete, it can be used for other settlement
                    }
                });

                // for the found and fitting stake accounts: taking first one and trying to merge other ones into it
                let stake_account_to_fund: Option<(FundBondStakeAccount, StakeAccountStateType)> =
                    if stake_accounts_to_fund.is_empty() || funding_lamports_accumulated == 0 {
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

                    match funding_lamports_accumulated
                        .cmp(&(amount_to_fund + minimal_stake_lamports))
                    {
                        Ordering::Less => {
                            reporting.warning().with_msg( format!(
                                "Cannot fully fund settlement {} (vote account {}, epoch {}, reason: {}, max claim {} SOLs, funder: ValidatorBond). To fund {} SOLs, to fund with min stake amount {}, only {} SOLs were found in stake accounts",
                                settlement_record.settlement_address,
                                settlement_record.vote_account_address,
                                epoch,
                                settlement_record.reason,
                                lamports_to_sol(settlement_record.max_total_claim_sum),
                                lamports_to_sol(amount_to_fund),
                                lamports_to_sol(amount_to_fund + minimal_stake_lamports),
                                lamports_to_sol(funding_lamports_accumulated)
                            )).with_vote(settlement_record.vote_account_address).add();
                            reporting.reportable.add_funded_settlement(
                                settlement_record,
                                funding_lamports_accumulated.saturating_sub(minimal_stake_lamports),
                            );
                        }
                        Ordering::Equal => {
                            // fully funded and whole stake account is used for the settlement funding
                            reporting
                                .reportable
                                .add_funded_settlement(settlement_record, amount_to_fund);
                        }
                        Ordering::Greater => {
                            // the stake account has got (or having after merging) more lamports than needed for the settlement in the current for-loop,
                            // the rest of lamports will be available in the split stake account
                            // and that can be used as a source for funding of next settlement when vote account is part of multiple settlements
                            // WARN: this REQUIRES that the merge stake transactions are executed in sequence!
                            let lamports_available_after_split = funding_lamports_accumulated
                                .saturating_sub(amount_to_fund)
                                .saturating_sub(minimal_stake_lamports);
                            // we are adding the stake account into next round of funding for next settlement
                            // after merging the stake account when the settlement is funded by real an on-chain tx (see fund_settlements)
                            // some funding will be left after fund+split within stake account, we can re-use the same account for a next settlement
                            funding_stake_accounts.push(FundBondStakeAccount {
                                lamports: lamports_available_after_split,
                                stake_account: destination_split_stake.pubkey(),
                                split_stake_account: Arc::new(Keypair::new()),
                                state: destination_stake_state,
                            });
                            reporting
                                .reportable
                                .add_funded_settlement(settlement_record, amount_to_fund);
                        }
                    }
                } else {
                    reporting.warning().with_msg(format!(
                        "Settlement {} (vote account {}, epoch {}, reason: {}, max claim {} SOLs, funder: ValidatorBond) not funded as no stake account available",
                        settlement_record.settlement_address,
                        settlement_record.vote_account_address,
                        epoch,
                        settlement_record.reason,
                        lamports_to_sol(settlement_record.max_total_claim_sum),
                    )).with_vote(settlement_record.vote_account_address).add();
                }
                // we've got to place in code where we wanted to fund something
                // it does not matter if it was successful or not (e.g., no stake account is available)
                // we need to track how much was funded before this, the calculated 'amount_to_fund'
                // reflects on how much is already funded, when subtracted from `max_total_claim_sum` then we get what has been already funded
                reporting.reportable.add_already_funded_settlement(
                    settlement_record,
                    settlement_record
                        .max_total_claim_sum
                        .saturating_sub(amount_to_fund),
                );
            }
        }
    }

    let execution_result_merging = execute_in_sequence(
        rpc_client.clone(),
        transaction_executor.clone(),
        &mut transaction_builder,
        priority_fee_policy,
        false,
    )
    .await;
    reporting.add_tx_execution_result(
        execution_result_merging,
        "Fund Settlement - Merge Stake Accounts",
    );

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
    reporting: &mut ReportHandler<FundSettlementsReport>,
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
                            vote_account: settlement_record.vote_account_address,
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
                            stake_config: stake_config_id,
                            program: validator_bonds_id,
                            event_authority: find_event_authority().0,
                        })
                        .args(validator_bonds::instruction::FundSettlement {});
                    transaction_builder.add_signer_checked(&split_stake_account_keypair);
                    add_instruction_to_builder(
                        &mut transaction_builder,
                        &req,
                        format!(
                            "FundSettlement: {}, bond: {}, vote: {}, reason: {}, stake: {}",
                            settlement_record.settlement_address,
                            settlement_record.bond_address,
                            settlement_record.vote_account_address,
                            settlement_record.reason,
                            stake_account_to_fund,
                        ),
                    )?;
                }
            }
            _ => {
                // reason should be already part of reporting and we don't want to double-add
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

    let execute_result_funding = execute_in_sequence(
        rpc_client.clone(),
        transaction_executor.clone(),
        &mut transaction_builder,
        priority_fee_policy,
        false,
    )
    .await;
    reporting.add_tx_execution_result(execute_result_funding, "FundSettlements");

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

#[derive(Default)]
struct FundSettlementsReport {
    settlements_per_epoch: HashMap<u64, FundSettlementReport>,
    institutional_validators: Option<ValidatorsData>,
}

#[derive(Default)]
struct FundSettlementReport {
    json_loaded_settlements: HashSet<SettlementRecord>,
    // settlements and amount funded for settlement
    funded_settlements: HashMap<Pubkey, (SettlementRecord, u64)>,
    already_funded_settlements: HashMap<Pubkey, (SettlementRecord, u64)>,
    not_funded_by_validator_bond_count: u64,
}

impl FundSettlementReport {
    fn funded_amount(&self) -> u64 {
        self.funded_settlements
            .values()
            .map(|(_, amount)| *amount)
            .sum()
    }

    fn already_funded_amount(&self) -> u64 {
        self.already_funded_settlements
            .values()
            .map(|(_, amount)| *amount)
            .sum()
    }
}

impl FundSettlementsReport {
    fn report_handler() -> ReportHandler<Self> {
        let fund_settlement_report = Self::default();
        ReportHandler::new(fund_settlement_report)
    }

    async fn init(
        &mut self,
        json_loaded_data: &HashMap<u64, Vec<SettlementRecord>>,
        institutional_url: Option<String>,
    ) {
        for (epoch, record) in json_loaded_data {
            self.settlements_per_epoch.insert(
                *epoch,
                FundSettlementReport {
                    json_loaded_settlements: record.iter().cloned().collect(),
                    ..Default::default()
                },
            );
        }
        if let Some(institutional_url) = institutional_url {
            self.institutional_validators = Some(fetch_validator_data(&institutional_url).await);
        }
    }

    fn add_funded_settlement(&mut self, record: &SettlementRecord, funded_amount: u64) {
        let report = self.mut_ref(record.epoch);
        report
            .funded_settlements
            .entry(record.settlement_address)
            .and_modify(|(_, amount)| *amount += funded_amount)
            .or_insert_with(|| (record.clone(), funded_amount));
    }

    fn add_already_fully_funded_settlement(&mut self, record: &SettlementRecord) {
        self.add_already_funded_settlement(record, record.max_total_claim_sum);
    }

    fn add_already_funded_settlement(&mut self, record: &SettlementRecord, funded_amount: u64) {
        let report = self.mut_ref(record.epoch);
        report
            .already_funded_settlements
            .entry(record.settlement_address)
            .and_modify(|(_, amount)| *amount += funded_amount)
            .or_insert_with(|| (record.clone(), funded_amount));
    }

    fn mut_ref(&mut self, epoch: u64) -> &mut FundSettlementReport {
        self.settlements_per_epoch.entry(epoch).or_default()
    }

    fn add_reason_specific_report(
        report: &mut Vec<String>,
        reason: ReportingReasonSettlement,
        funded_data: &FundSettlementReport,
    ) {
        let json_loaded = SettlementsReportData::calculate_for_reason(
            &reason,
            &funded_data.json_loaded_settlements,
        );

        let funded = SettlementsReportData::calculate_sum_amount_for_reason(
            &reason,
            &funded_data.funded_settlements,
        );

        let already_funded = SettlementsReportData::calculate_sum_amount_for_reason(
            &reason,
            &funded_data.already_funded_settlements,
        );

        if json_loaded.settlements_count > 0 {
            report.push(format!(
                "  - {}: funded {}/{} settlements with {}/{} SOLs (before this already funded {}/{} settlements with {}/{} SOLs)",
                reason,
                funded.0.settlements_count,
                json_loaded.settlements_count,
                lamports_to_sol(funded.1),
                lamports_to_sol(json_loaded.settlements_max_claim_sum),
                already_funded.0.settlements_count,
                json_loaded.settlements_count,
                lamports_to_sol(already_funded.1),
                lamports_to_sol(json_loaded.settlements_max_claim_sum),
            ));
        }
    }
}

impl PrintReportable for FundSettlementsReport {
    fn get_report(&self) -> Pin<Box<dyn Future<Output = Vec<String>> + '_>> {
        Box::pin(async {
            let mut report = vec![];
            let mut sorted_by_epoch = self
                .settlements_per_epoch
                .iter()
                .collect::<Vec<(&u64, &FundSettlementReport)>>();
            sorted_by_epoch.sort_by_key(|(a, _)| *a);
            for (epoch, funded_data) in sorted_by_epoch {
                let json_loaded = SettlementsReportData::calculate(
                    &funded_data
                        .json_loaded_settlements
                        .iter()
                        .collect::<Vec<&SettlementRecord>>(),
                );
                let already_funded_count = funded_data
                    .already_funded_settlements
                    .iter()
                    .filter(|(_, (_, amount))| *amount > 0)
                    .count();
                report.push(format!(
                    "Epoch {} funded {}/{} settlements with {}/{} SOLs (before this already funded {}/{} settlements with {}/{} SOLs)",
                    epoch,
                    funded_data.funded_settlements.len(),
                    json_loaded.settlements_count,
                    lamports_to_sol(funded_data.funded_amount()),
                    lamports_to_sol(json_loaded.settlements_max_claim_sum),
                    already_funded_count,
                    json_loaded.settlements_count,
                    lamports_to_sol(funded_data.already_funded_amount()),
                    lamports_to_sol(json_loaded.settlements_max_claim_sum),
                ));
                for reason in ReportingReasonSettlement::items() {
                    Self::add_reason_specific_report(&mut report, reason, funded_data);
                }
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

    fn transform_on_finalize(&self, entries: &mut Vec<ErrorEntry>) {
        if let Some(institutional_validators) = &self.institutional_validators {
            entries.iter_mut().for_each(|entry| {
                match entry {
                    Generic(_) => {
                        // nothing
                    }
                    VoteAccount(vae) => {
                        if institutional_validators
                            .validators
                            .iter()
                            .all(|v| v.vote_pubkey != vae.vote_account)
                        {
                            vae.base.severity = ErrorSeverity::Info;
                            vae.base.message =
                                format!("(non-institutional validator) {}", vae.base.message);
                        }
                    }
                }
            });
        }
    }
}
