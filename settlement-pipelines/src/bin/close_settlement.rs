use anchor_client::anchor_lang::solana_program::stake::state::StakeStateV2;
use anyhow::anyhow;
use clap::Parser;
use log::{error, info};
use settlement_engine::utils::read_from_json_file;
use settlement_pipelines::anchor::add_instruction_to_builder_from_anchor_with_description;
use settlement_pipelines::arguments::{
    init_from_opts, load_pubkey, GlobalOpts, InitializedGlobalOpts, PriorityFeePolicyOpts,
    TipPolicyOpts,
};
use settlement_pipelines::init::init_log;
use settlement_pipelines::json_data::BondSettlement;
use settlement_pipelines::settlements::list_expired_settlements;
use settlement_pipelines::stake_accounts::filter_settlement_funded;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signer::Signer;
use solana_sdk::stake::config::ID as stake_config_id;
use solana_sdk::stake::program::ID as stake_program_id;
use solana_sdk::sysvar::{
    clock::ID as clock_sysvar_id, stake_history::ID as stake_history_sysvar_id,
};
use solana_transaction_builder::TransactionBuilder;
use solana_transaction_builder_executor::{
    builder_to_execution_data, execute_transactions_in_parallel,
};
use solana_transaction_executor::{
    SendTransactionWithGrowingTipProvider, TransactionExecutorBuilder,
};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use validator_bonds::state::bond::Bond;
use validator_bonds::state::config::find_bonds_withdrawer_authority;
use validator_bonds::state::settlement::{find_settlement_staker_authority, Settlement};
use validator_bonds::ID as validator_bonds_id;
use validator_bonds_common::bonds::get_bonds_for_pubkeys;
use validator_bonds_common::config::get_config;
use validator_bonds_common::constants::find_event_authority;
use validator_bonds_common::settlement_claims::get_settlement_claims;
use validator_bonds_common::settlements::get_settlements;
use validator_bonds_common::stake_accounts::collect_stake_accounts;
use validator_bonds_common::utils::get_sysvar_clock;

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

    #[clap(long)]
    past_settlements: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Args = Args::parse();
    init_log(&args.global_opts);

    let InitializedGlobalOpts {
        rpc_url,
        fee_payer_keypair,
        fee_payer_pubkey,
        operator_authority_keypair,
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
        .map_err(|e| anyhow!("Failed to load --marinade-wallet: {:?}", e))?;
    let past_settlements: Vec<BondSettlement> = read_from_json_file(args.past_settlements.as_str())
        .map_err(|e| anyhow!("Failed to load --past-settlements: {:?}", e))?;

    let config_address = args.global_opts.config;
    info!(
        "Closing Settlements and Settlement Claims for validator-bonds config: {}",
        config_address
    );
    let config = get_config(rpc_client.clone(), config_address).await?;
    let (bonds_withdrawer_authority, _) = find_bonds_withdrawer_authority(&config_address);

    let mut close_settlement_errors: Vec<String> = vec![];

    let mut transaction_builder = TransactionBuilder::limited(fee_payer_keypair.clone());

    // Close Settlements
    let expired_settlements =
        list_expired_settlements(rpc_client.clone(), &config_address, &config).await?;
    let expired_settlements_bond_pubkeys = expired_settlements
        .iter()
        .map(|(_, settlement)| settlement.bond)
        .collect::<HashSet<Pubkey>>()
        .into_iter()
        .collect::<Vec<Pubkey>>();
    let bonds =
        get_bonds_for_pubkeys(rpc_client.clone(), &expired_settlements_bond_pubkeys).await?;
    let expired_settlements_closed = expired_settlements
        .into_iter()
        .map(|(pubkey, settlement)| {
            let bond = bonds
                .iter()
                .find(|(bond_pubkey, _)| bond_pubkey == &settlement.bond)
                .map_or_else(|| None, |(_, bond)| bond.clone());
            (pubkey, settlement, bond)
        })
        .collect::<Vec<(Pubkey, Settlement, Option<Bond>)>>();

    // TODO: this HAS TO BE REFACTORED into function!
    let transaction_executor_builder = TransactionExecutorBuilder::new()
        .with_default_providers(rpc_client.clone())
        .with_send_transaction_provider(SendTransactionWithGrowingTipProvider {
            rpc_url: rpc_url.clone(),
            query_param: "tip".into(),
            tip_policy,
        });
    let transaction_executor = Arc::new(transaction_executor_builder.build());

    for (settlement_address, settlement, _) in expired_settlements_closed.iter() {
        let (settlement_staker_authority, _) = find_settlement_staker_authority(settlement_address);

        // Finding rent collector and refund stake account for closing settlement
        // TODO: refactor to a separate function
        let (split_rent_collector, split_rent_refund_account) = {
            if let Some(split_rent_collector) = settlement.split_rent_collector {
                let split_rent_refund_accounts = collect_stake_accounts(
                    rpc_client.clone(),
                    Some(&bonds_withdrawer_authority),
                    Some(&settlement_staker_authority),
                )
                .await;
                let split_rent_refund_accounts = if let Err(e) = split_rent_refund_accounts {
                    let error_msg = format!(
                        "For closing settlement {} is required return rent as collector field is setup {}, but failed to list settlement funded stake account to use for returning rent: {:?}",
                        settlement_address, split_rent_collector, e
                    );
                    error!("{}", error_msg);
                    close_settlement_errors.push(error_msg);
                    continue;
                } else {
                    split_rent_refund_accounts?
                };
                let split_rent_refund_account = if let Some(first_account) =
                    split_rent_refund_accounts.first()
                {
                    first_account.0
                } else {
                    let error_msg = format!(
                        "For closing settlement {} is required return rent as collector field is setup {}, but no settlement funded stake account found to use for returning rent",
                        settlement_address, split_rent_collector
                    );
                    error!("{}", error_msg);
                    close_settlement_errors.push(error_msg);
                    continue;
                };
                (split_rent_collector, split_rent_refund_account)
            } else {
                // whatever existing account, contract won't use it
                (fee_payer_pubkey, fee_payer_pubkey)
            }
        };

        let req = program
            .request()
            .accounts(validator_bonds::accounts::CloseSettlement {
                config: config_address,
                bond: settlement.bond,
                settlement: *settlement_address,
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
            .args(validator_bonds::instruction::CloseSettlement {});
        add_instruction_to_builder_from_anchor_with_description(
            &mut transaction_builder,
            &req,
            format!(
                "Close Settlement {settlement_address} with refund account {}",
                split_rent_refund_account
            ),
        )?;
    }

    let close_settlement_execution_count = transaction_builder.instructions().len();
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
    .await?;
    info!(
        "CloseSettlement instructions {close_settlement_execution_count} executed successfully of settlements [{}]",
        expired_settlements_closed
            .iter()
            .map(|(p,_, _)| p.to_string())
            .collect::<Vec<String>>()
            .join(", ")
    );

    let existing_settlements_pubkeys = get_settlements(rpc_client.clone())
        .await?
        .into_iter()
        // settlement pubkey -> staker authority pubkey
        .map(|(pubkey, _)| (pubkey, find_settlement_staker_authority(&pubkey).0))
        .collect::<HashMap<Pubkey, Pubkey>>();

    // Search for Settlement Claims that points to non-existing Settlements
    let settlement_claim_records = get_settlement_claims(rpc_client.clone()).await?;
    for (settlement_claim_address, settlement_claim) in settlement_claim_records {
        if existing_settlements_pubkeys
            .get(&settlement_claim.settlement)
            .is_none()
        {
            let req = program
                .request()
                .accounts(validator_bonds::accounts::CloseSettlementClaim {
                    settlement: settlement_claim.settlement,
                    settlement_claim: settlement_claim_address,
                    rent_collector: settlement_claim.rent_collector,
                    program: validator_bonds_id,
                    event_authority: find_event_authority().0,
                })
                .args(validator_bonds::instruction::CloseSettlementClaim {});
            add_instruction_to_builder_from_anchor_with_description(
                &mut transaction_builder,
                &req,
                format!(
                    "Close Settlement Claim {settlement_claim_address} of settlement {}",
                    settlement_claim.settlement
                ),
            )?;
        }
    }

    // Verification of stake account existence that belongs to Settlements that does not exist
    let clock = get_sysvar_clock(rpc_client.clone()).await?;
    let all_stake_accounts =
        collect_stake_accounts(rpc_client.clone(), Some(&bonds_withdrawer_authority), None).await?;
    let settlement_funded_stake_accounts = filter_settlement_funded(all_stake_accounts, &clock);
    let existing_settlements_staker_authorities = existing_settlements_pubkeys
        .keys()
        .map(|settlement_address| {
            (
                find_settlement_staker_authority(settlement_address).0,
                existing_settlements_pubkeys
                    .get(settlement_address)
                    .is_some(),
            )
        })
        .collect::<HashMap<Pubkey, bool>>();
    // looking at list of provided settlement addresses from argument
    // verification what of those are not existing anymore
    let not_existing_past_settlements = past_settlements
        .into_iter()
        .filter(|data| {
            existing_settlements_pubkeys
                .get(&data.settlement_address)
                .is_none()
        })
        .collect::<Vec<BondSettlement>>();
    let non_existing_settlements_staker_authorities = expired_settlements_closed
        .into_iter()
        .map(|(settlement_address, settlement, bond)| {
            (
                settlement_address,
                settlement.bond,
                bond.map_or_else(|| None, |b| Some(b.vote_account)),
            )
        })
        .chain(not_existing_past_settlements.into_iter().map(
            |BondSettlement {
                 bond_address,
                 settlement_address,
                 vote_account_address,
                 merkle_root: _,
                 epoch: _,
             }| (settlement_address, bond_address, Some(vote_account_address)),
        ))
        .map(|(settlement, bond, vote_account)| {
            (
                find_settlement_staker_authority(&settlement).0,
                ResetStakeData {
                    vote_account,
                    bond,
                    settlement,
                },
            )
        })
        // staker authority -> (settlement address, bond address, bond address)
        .collect::<HashMap<Pubkey, ResetStakeData>>();
    for (stake_pubkey, _, stake_state) in settlement_funded_stake_accounts {
        let staker_authority = if let Some(authorized) = stake_state.authorized() {
            authorized.staker
        } else {
            // this should be already filtered out, not correctly funded settlement
            continue;
        };
        // there is a stake account that belongs to a settlement that does not exist
        let reset_data = if let Some(reset_data) =
            non_existing_settlements_staker_authorities.get(&staker_authority)
        {
            reset_data
        } else {
            // if the stake account does not belong to a non-existent settlement then it has to belongs
            // to an existing settlement, if not than we have dangling stake account that should be reported
            if existing_settlements_staker_authorities
                .get(&staker_authority)
                .is_none()
            {
                // -> not existing settlement for this stake account, and we know nothing is about
                let error_msg = format!(
                    "For stake account {} (staker authority: {}) is required to know Settlement address but that was lost. Manual intervention needed.",
                    stake_pubkey, staker_authority
                );
                error!("{}", error_msg);
                close_settlement_errors.push(error_msg);
            }
            continue;
        };

        if let StakeStateV2::Initialized(_) = stake_state {
            transaction_builder.add_signer_checked(&operator_authority_keypair);
            // Initialized non-delegated can be withdrawn by operator
            let req = program
                .request()
                .accounts(validator_bonds::accounts::WithdrawStake {
                    config: config_address,
                    operator_authority: operator_authority_keypair.pubkey(),
                    settlement: reset_data.settlement,
                    stake_account: stake_pubkey,
                    bonds_withdrawer_authority,
                    withdraw_to: marinade_wallet,
                    stake_history: stake_history_sysvar_id,
                    clock: clock_sysvar_id,
                    stake_program: stake_program_id,
                    program: validator_bonds_id,
                    event_authority: find_event_authority().0,
                })
                .args(validator_bonds::instruction::WithdrawStake {});
            add_instruction_to_builder_from_anchor_with_description(
                &mut transaction_builder,
                &req,
                format!(
                    "Withdraw un-claimed stake account {stake_pubkey} for settlement {}",
                    reset_data.settlement
                ),
            )?;
        } else if let Some(settlement_vote_account) = reset_data.vote_account {
            // Delegated stake account can be reset to a bond
            let req = program
                .request()
                .accounts(validator_bonds::accounts::ResetStake {
                    config: config_address,
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
            add_instruction_to_builder_from_anchor_with_description(
                &mut transaction_builder,
                &req,
                format!(
                    "Reset un-claimed stake account {stake_pubkey} for settlement {}",
                    reset_data.settlement
                ),
            )?;
        } else {
            let error_msg = format!(
                "To reset stake account {} (bond: {}, staker authority: {}) is required to know vote account address but that was lost. Manual intervention needed.",
                stake_pubkey, reset_data.bond, staker_authority
            );
            error!("{}", error_msg);
            close_settlement_errors.push(error_msg);
        }
    }

    let reset_stake_accounts_execution_count = transaction_builder.instructions().len();
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
    .await?;
    info!("Reset and Withdraw StakeAccounts instructions {reset_stake_accounts_execution_count}",);
    assert_eq!(
        transaction_builder.instructions().len(),
        0,
        "Expected all instructions from builder are processed"
    );

    Ok(())
}

struct ResetStakeData {
    bond: Pubkey,
    vote_account: Option<Pubkey>,
    settlement: Pubkey,
}
