use anchor_client::anchor_lang::solana_program::stake::state::StakeStateV2;
use anyhow::anyhow;
use clap::Parser;
use log::{debug, info};
use settlement_engine::utils::read_from_json_file;
use settlement_pipelines::anchor::add_instruction_to_builder_from_anchor_with_description;
use settlement_pipelines::arguments::{
    init_from_opts, load_pubkey, GlobalOpts, InitializedGlobalOpts, PriorityFeePolicyOpts,
    TipPolicyOpts,
};
use settlement_pipelines::executor::execute_parallel;
use settlement_pipelines::init::{get_executor, init_log};
use settlement_pipelines::json_data::BondSettlement;
use settlement_pipelines::settlements::{
    list_expired_settlements, obtain_settlement_closing_refunds, SettlementRefundPubkeys,
    SETTLEMENT_CLAIM_ACCOUNT_SIZE,
};
use settlement_pipelines::stake_accounts::filter_settlement_funded;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;

use anchor_client::{DynSigner, Program};
use settlement_pipelines::reporting::{PrintReportable, ReportHandler};
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
use std::pin::Pin;
use std::rc::Rc;
use std::sync::Arc;
use validator_bonds::state::bond::Bond;
use validator_bonds::state::config::{find_bonds_withdrawer_authority, Config};
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
        .map_err(|e| anyhow!("Failed to load --marinade-wallet: {:?}", e))?;
    let past_settlements: Vec<BondSettlement> = read_from_json_file(args.past_settlements.as_str())
        .map_err(|e| anyhow!("Failed to load --past-settlements: {:?}", e))?;

    let config_address = args.global_opts.config;
    info!(
        "Closing Settlements and Settlement Claims and Resetting Stake Accounts for validator-bonds config: {}",
        config_address
    );
    let config = get_config(rpc_client.clone(), config_address).await?;

    let mut reporting = CloseSettlementReport::report_handler(rpc_client.clone(), marinade_wallet);

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
        &mut reporting,
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

    close_settlement_claims(
        &program,
        rpc_client.clone(),
        &mut transaction_builder,
        transaction_executor.clone(),
        &mapping_settlements_to_staker_authority,
        &priority_fee_policy,
        &mut reporting,
    )
    .await?;

    reset_stake_accounts(
        &program,
        rpc_client.clone(),
        &mut transaction_builder,
        transaction_executor.clone(),
        &mapping_settlements_to_staker_authority,
        expired_settlements,
        past_settlements,
        &config_address,
        &operator_authority_keypair,
        &marinade_wallet,
        &priority_fee_policy,
        &mut reporting,
    )
    .await?;

    reporting.report().await
}

#[allow(clippy::too_many_arguments)]
async fn close_settlements(
    program: &Program<Rc<DynSigner>>,
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
                    reporting.add_error(e);
                    continue;
                }
            };

        let req = program
            .request()
            .accounts(validator_bonds::accounts::CloseSettlement {
                config: *config_address,
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
            transaction_builder,
            &req,
            format!(
                "Close Settlement {settlement_address} with refund account {}",
                split_rent_refund_account
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
    reporting.reportable.set_settlements(expired_settlements);
    let settlements_list = reporting.reportable.list_closed_settlements();
    reporting.add_execution_result(
        execution_result,
        format!("CloseSettlements [{settlements_list}]").as_str(),
    );

    Ok(())
}

async fn close_settlement_claims(
    program: &Program<Rc<DynSigner>>,
    rpc_client: Arc<RpcClient>,
    transaction_builder: &mut TransactionBuilder,
    transaction_executor: Arc<TransactionExecutor>,
    mapping_settlements_to_staker_authority: &HashMap<Pubkey, Pubkey>,
    priority_fee_policy: &PriorityFeePolicy,
    reporting: &mut ReportHandler<CloseSettlementReport>,
) -> anyhow::Result<()> {
    // Search for Settlement Claims that points to non-existing Settlements
    let settlement_claim_records = get_settlement_claims(rpc_client.clone()).await?;
    for (settlement_claim_address, settlement_claim) in settlement_claim_records {
        if mapping_settlements_to_staker_authority
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
                transaction_builder,
                &req,
                format!(
                    "Close Settlement Claim {settlement_claim_address} of settlement {}",
                    settlement_claim.settlement
                ),
            )?;
            reporting
                .reportable
                .add_settlement_claim(settlement_claim_address);
        }
    }

    let execution_result = execute_parallel(
        rpc_client.clone(),
        transaction_executor.clone(),
        transaction_builder,
        priority_fee_policy,
    )
    .await;
    reporting.add_execution_result(execution_result, "CloseSettlementClaim");
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn reset_stake_accounts(
    program: &Program<Rc<DynSigner>>,
    rpc_client: Arc<RpcClient>,
    transaction_builder: &mut TransactionBuilder,
    transaction_executor: Arc<TransactionExecutor>,
    mapping_settlements_to_staker_authority: &HashMap<Pubkey, Pubkey>,
    expired_settlements: Vec<(Pubkey, Settlement, Option<Bond>)>,
    past_settlements: Vec<BondSettlement>,
    config_address: &Pubkey,
    operator_authority_keypair: &Rc<Keypair>,
    marinade_wallet: &Pubkey,
    priority_fee_policy: &PriorityFeePolicy,
    reporting: &mut ReportHandler<CloseSettlementReport>,
) -> anyhow::Result<()> {
    let (bonds_withdrawer_authority, _) = find_bonds_withdrawer_authority(config_address);
    let non_existing_settlements_staker_authority = get_expired_stake_accounts(
        mapping_settlements_to_staker_authority,
        past_settlements,
        expired_settlements,
    );
    let staker_authority_to_existing_settlements = mapping_settlements_to_staker_authority
        .iter()
        .map(|(settlement, staker_authority)| (*staker_authority, *settlement))
        .collect::<HashMap<Pubkey, Pubkey>>();
    debug!(
        "Non-existing Settlements staker authorities: {:?}",
        non_existing_settlements_staker_authority
            .iter()
            .map(|(k, v)| (k, v.settlement))
            .collect::<Vec<(&Pubkey, Pubkey)>>()
    );
    let clock = get_sysvar_clock(rpc_client.clone()).await?;
    let all_stake_accounts =
        collect_stake_accounts(rpc_client.clone(), Some(&bonds_withdrawer_authority), None).await?;
    let settlement_funded_stake_accounts = filter_settlement_funded(all_stake_accounts, &clock);
    for (stake_pubkey, lamports, stake_state) in settlement_funded_stake_accounts {
        let staker_authority = if let Some(authorized) = stake_state.authorized() {
            authorized.staker
        } else {
            // this should be already filtered out, not correctly funded settlement
            continue;
        };
        // there is a stake account that belongs to a settlement that does not exist
        let reset_data = if let Some(reset_data) =
            non_existing_settlements_staker_authority.get(&staker_authority)
        {
            reset_data
        } else {
            // if the stake account does not belong to a non-existent settlement then it has to belongs
            // to an existing settlement, if not than we have dangling stake account that should be reported
            if staker_authority_to_existing_settlements
                .get(&staker_authority)
                .is_none()
            {
                // -> not existing settlement for this stake account, and we know nothing is about
                reporting.add_error_string(format!(
                    "For stake account {} (staker authority: {}) is required to know Settlement address but that was lost. Manual intervention needed.",
                    stake_pubkey, staker_authority
                ));
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
            add_instruction_to_builder_from_anchor_with_description(
                transaction_builder,
                &req,
                format!(
                    "Withdraw un-claimed stake account {stake_pubkey} for settlement {}",
                    reset_data.settlement
                ),
            )?;
            reporting
                .reportable
                .add_withdraw_stake(stake_pubkey, lamports);
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
            add_instruction_to_builder_from_anchor_with_description(
                transaction_builder,
                &req,
                format!(
                    "Reset un-claimed stake account {stake_pubkey} for settlement {}",
                    reset_data.settlement
                ),
            )?;
            reporting.reportable.add_reset_stake(stake_pubkey, lamports);
        } else {
            reporting.add_error_string(format!(
                "To reset stake account {} (bond: {}, staker authority: {}) is required to know vote account address but that was lost. Manual intervention needed.",
                stake_pubkey, reset_data.bond, staker_authority
            ));
        }
    }

    let execution_result = execute_parallel(
        rpc_client.clone(),
        transaction_executor.clone(),
        transaction_builder,
        priority_fee_policy,
    )
    .await;
    reporting.add_execution_result(execution_result, "Reset/WithdrawStakeAccounts");
    Ok(())
}

async fn get_expired_settlements(
    rpc_client: Arc<RpcClient>,
    config_address: &Pubkey,
    config: &Config,
) -> anyhow::Result<Vec<(Pubkey, Settlement, Option<Bond>)>> {
    let expired_settlements =
        list_expired_settlements(rpc_client.clone(), config_address, config).await?;
    let expired_settlements_bond_pubkeys = expired_settlements
        .iter()
        .map(|(_, settlement)| settlement.bond)
        .collect::<HashSet<Pubkey>>()
        .into_iter()
        .collect::<Vec<Pubkey>>();
    let bonds = get_bonds_for_pubkeys(rpc_client, &expired_settlements_bond_pubkeys).await?;
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
    past_settlements: Vec<BondSettlement>,
    expired_settlements: Vec<(Pubkey, Settlement, Option<Bond>)>,
) -> HashMap<Pubkey, ResetStakeData> {
    // settlement addresses from argument -> verification what are not existing
    let not_existing_past_settlements = past_settlements
        .into_iter()
        .filter(|data| existing_settlements.get(&data.settlement_address).is_none())
        .collect::<Vec<BondSettlement>>();
    expired_settlements
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
        .collect::<HashMap<Pubkey, ResetStakeData>>()
}

struct ResetStakeData {
    bond: Pubkey,
    vote_account: Option<Pubkey>,
    settlement: Pubkey,
}

struct CloseSettlementReport {
    rpc_client: Arc<RpcClient>,
    withdraw_wallet: Pubkey,
    /// settlement pubkey, bond account pubkey
    closed_settlements: Vec<(Pubkey, Pubkey)>,
    closed_settlement_claims: Vec<Pubkey>,
    reset_stake: Vec<(Pubkey, u64)>,
    withdraw_stake: Vec<(Pubkey, u64)>,
}

impl PrintReportable for CloseSettlementReport {
    fn get_report(&self) -> Pin<Box<dyn Future<Output = Vec<String>> + '_>> {
        Box::pin(async {
            let settlement_claim_rent = self
                .rpc_client
                .get_minimum_balance_for_rent_exemption(SETTLEMENT_CLAIM_ACCOUNT_SIZE)
                .await
                .unwrap();
            vec![
                format!(
                    "Number of closed settlements: {}",
                    self.closed_settlements.len()
                ),
                format!(
                    "Number of closed settlement claims: {}, sum of returned rent {}",
                    self.closed_settlement_claims.len(),
                    self.closed_settlement_claims.len() as u64 * settlement_claim_rent
                ),
                format!("Number of reset stake accounts: {}, sum of reset lamports: {}", self.reset_stake.len(), self.reset_stake_lamports()),
                format!("Number of withdraw stake accounts: {}, sum of withdrawn lamports: {} to wallet {}", self.reset_stake.len(), self.withdraw_stake_lamports(), self.withdraw_wallet),
            ]
        })
    }
}

impl CloseSettlementReport {
    fn report_handler(rpc_client: Arc<RpcClient>, withdraw_wallet: Pubkey) -> ReportHandler<Self> {
        let close_settlement_report = Self {
            rpc_client,
            withdraw_wallet,
            closed_settlements: vec![],
            closed_settlement_claims: vec![],
            reset_stake: vec![],
            withdraw_stake: vec![],
        };
        ReportHandler::new(close_settlement_report)
    }

    fn set_settlements(&mut self, settlements: &[(Pubkey, Settlement, Option<Bond>)]) {
        self.closed_settlements = settlements
            .iter()
            .map(|(p, s, _)| (*p, s.bond))
            .collect::<Vec<(Pubkey, Pubkey)>>();
    }

    fn list_closed_settlements(&self) -> String {
        self.closed_settlements
            .iter()
            .map(|(p, _)| p.to_string())
            .collect::<Vec<String>>()
            .join(",")
    }

    fn add_settlement_claim(&mut self, settlement_claim: Pubkey) {
        self.closed_settlement_claims.push(settlement_claim);
    }

    fn add_reset_stake(&mut self, stake_pubkey: Pubkey, lamports: u64) {
        self.reset_stake.push((stake_pubkey, lamports));
    }

    fn reset_stake_lamports(&self) -> u64 {
        self.reset_stake
            .iter()
            .map(|(_, lamports)| lamports)
            .sum::<u64>()
    }

    fn add_withdraw_stake(&mut self, stake_pubkey: Pubkey, lamports: u64) {
        self.withdraw_stake.push((stake_pubkey, lamports));
    }

    fn withdraw_stake_lamports(&self) -> u64 {
        self.withdraw_stake
            .iter()
            .map(|(_, lamports)| lamports)
            .sum::<u64>()
    }
}
