use crate::checks::{
    check_stake_is_initialized_with_withdrawer_authority, check_stake_is_not_locked,
};
use crate::constants::BONDS_WITHDRAWER_AUTHORITY_SEED;
use crate::error::ErrorCode;
use crate::events::settlement_claim::ClaimSettlementV2Event;
use crate::events::U64ValueChange;
use crate::state::bond::Bond;
use crate::state::config::Config;
use crate::state::settlement::Settlement;
use crate::state::settlement_claims::{SettlementClaims, SettlementClaimsWrapped};
use crate::utils::{merkle_proof, minimal_size_stake_account};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use anchor_lang::solana_program::sysvar::stake_history;
use anchor_spl::stake::{withdraw, Stake, StakeAccount, Withdraw};
use merkle_tree::psr_claim::TreeNode;
use merkle_tree::{hash_leaf, LEAF_PREFIX};

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct ClaimSettlementV2Args {
    /// proof that the claim is appropriate
    pub proof: Vec<[u8; 32]>,
    // tree node hash; PDA seed
    pub tree_node_hash: [u8; 32],
    /// staker authority of the stake_account_to; merkle root verification
    pub stake_account_staker: Pubkey,
    /// withdrawer authority of the stake_account_to; merkle root verification
    pub stake_account_withdrawer: Pubkey,
    /// claim amount; merkle root verification
    pub claim: u64,
    /// index, ordered claim record in the settlement list; merkle root verification
    pub index: u64,
}

/// Claims a settlement by withdrawing settlement funded stake account
/// Note that stakes-etl depends on the name of this ix during parsing
/// Details: https://github.com/marinade-finance/stakes-etl/pull/37/files#diff-ad9542b32b7cdc67ba56f59d71997f611c0ba3ad23bfb024822e5c52304145f7R32
#[event_cpi]
#[derive(Accounts)]
#[instruction(params: ClaimSettlementV2Args)]
pub struct ClaimSettlementV2<'info> {
    /// the config account under which the settlement was created
    pub config: Box<Account<'info, Config>>,

    #[account(
        has_one = config @ ErrorCode::ConfigAccountMismatch,
        seeds = [
            b"bond_account",
            config.key().as_ref(),
            bond.vote_account.as_ref(),
        ],
        bump = bond.bump,
    )]
    pub bond: Account<'info, Bond>,

    #[account(
        mut,
        has_one = bond @ ErrorCode::BondAccountMismatch,
        constraint = settlement.epoch_created_for + config.epochs_to_claim_settlement >= clock.epoch @ ErrorCode::SettlementExpired,
        constraint = settlement.slot_created_at + config.slots_to_start_settlement_claiming <= clock.slot @ ErrorCode::SettlementNotReadyForClaiming,
        seeds = [
            b"settlement_account",
            bond.key().as_ref(),
            settlement.merkle_root.as_ref(),
            settlement.epoch_created_for.to_le_bytes().as_ref(),
        ],
        bump = settlement.bumps.pda,
    )]
    pub settlement: Account<'info, Settlement>,

    /// deduplication, merkle tree record cannot be claimed twice
    #[account(
        mut,
        has_one = settlement @ ErrorCode::BondAccountMismatch,
        seeds = [
            b"claims_account",
            settlement.key().as_ref(),
        ],
        bump = settlement.bumps.settlement_claims,
    )]
    pub settlement_claims: Account<'info, SettlementClaims>,

    /// a stake account that will be withdrawn
    #[account(mut)]
    pub stake_account_from: Box<Account<'info, StakeAccount>>,

    /// a stake account that will receive the funds
    #[account(
        mut,
        constraint = stake_account_from.key() != stake_account_to.key() @ ErrorCode::MergeMismatchSameSourceDestination
    )]
    pub stake_account_to: Box<Account<'info, StakeAccount>>,

    /// CHECK: PDA
    /// authority that manages (owns == by being withdrawer authority) all stakes account under the bonds program
    #[account(
        seeds = [
            b"bonds_authority",
            config.key().as_ref(),
        ],
        bump = config.bonds_withdrawer_authority_bump
    )]
    pub bonds_withdrawer_authority: UncheckedAccount<'info>,

    /// CHECK: have no CPU budget to parse
    #[account(address = stake_history::ID)]
    pub stake_history: UncheckedAccount<'info>,

    pub clock: Sysvar<'info, Clock>,

    pub stake_program: Program<'info, Stake>,
}

impl<'info> ClaimSettlementV2<'info> {
    pub fn process(
        ctx: Context<ClaimSettlementV2>,
        ClaimSettlementV2Args {
            proof,
            tree_node_hash: tree_node_hash_args,
            claim,
            stake_account_staker,
            stake_account_withdrawer,
            index,
        }: ClaimSettlementV2Args,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, ErrorCode::ProgramIsPaused);

        let mut settlement_claims = SettlementClaimsWrapped::new(&ctx.accounts.settlement_claims)?;
        require!(
            settlement_claims.try_to_set(index)?,
            ErrorCode::SettlementAlreadyClaimed
        );

        // settlement_claim PDA address verification
        let tree_node = TreeNode {
            stake_authority: stake_account_staker,
            withdraw_authority: stake_account_withdrawer,
            claim,
            index,
            proof: None,
        };
        let tree_node_bytes = tree_node.hash().to_bytes();
        if tree_node_bytes != tree_node_hash_args {
            return Err(
                error!(ErrorCode::ClaimSettlementMerkleTreeNodeMismatch).with_values((
                    "tree_node_bytes vs. tree_node_hash_args",
                    format!("'{:?}' vs. '{:?}'", tree_node_bytes, tree_node_hash_args),
                )),
            );
        }

        if ctx.accounts.settlement.lamports_claimed + claim
            > ctx.accounts.settlement.max_total_claim
        {
            return Err(error!(ErrorCode::ClaimAmountExceedsMaxTotalClaim)
                .with_account_name("settlement")
                .with_values((
                    "lamports_claimed + claim > max_total_claim",
                    format!(
                        "{} + {} <= {}",
                        ctx.accounts.settlement.lamports_claimed,
                        claim,
                        ctx.accounts.settlement.max_total_claim
                    ),
                )));
        }
        if ctx.accounts.settlement.merkle_nodes_claimed + 1
            > ctx.accounts.settlement.max_merkle_nodes
        {
            return Err(error!(ErrorCode::ClaimCountExceedsMaxMerkleNodes)
                .with_account_name("settlement")
                .with_values((
                    "merkle_nodes_claimed + 1 > max_merkle_nodes",
                    format!(
                        "{} + 1 > {}",
                        ctx.accounts.settlement.merkle_nodes_claimed,
                        ctx.accounts.settlement.max_merkle_nodes
                    ),
                )));
        }

        // stake account is managed by bonds program
        let stake_from_meta = check_stake_is_initialized_with_withdrawer_authority(
            &ctx.accounts.stake_account_from,
            &ctx.accounts.bonds_withdrawer_authority.key(),
            "stake_account_from",
        )?;
        // provided stake account "from" must be funded; staker == settlement staker authority
        require_keys_eq!(
            stake_from_meta.authorized.staker,
            ctx.accounts.settlement.staker_authority,
            ErrorCode::StakeAccountNotFundedToSettlement,
        );

        // stake account "to" for withdrawing funds to has to match merkle proof data
        let stake_to_meta = check_stake_is_initialized_with_withdrawer_authority(
            &ctx.accounts.stake_account_to,
            &stake_account_withdrawer,
            "stake_account_to",
        )?;
        require_keys_eq!(
            stake_to_meta.authorized.staker,
            stake_account_staker,
            ErrorCode::WrongStakeAccountStaker,
        );
        // an attacker could create a locked stake account with the victims stake/withdraw authorities,
        // then claiming the settlement, and extort the victim to unlock the stake account
        check_stake_is_not_locked(
            &ctx.accounts.stake_account_to,
            &ctx.accounts.clock,
            "stake_account_to",
        )?;

        // The provided stake account must be sufficiently large to cover the claim while remaining valid.
        // It is the caller's responsibility to merge stake accounts if necessary.
        // - The invariant is that the stake account will always be rent-exempt and of minimum size.
        //   This must be ensured by the fund_settlement instruction.
        if ctx.accounts.stake_account_from.get_lamports()
            < claim + minimal_size_stake_account(&stake_from_meta, &ctx.accounts.config) &&
            // on perfect match when stake account lamports is equal to the claim amount we can withdraw all
            ctx.accounts.stake_account_from.get_lamports() != claim
        {
            return Err(error!(ErrorCode::ClaimingStakeAccountLamportsInsufficient)
                .with_account_name("stake_account_from")
                .with_values((
                    "stake_account_from_lamports < claim_amount + minimal_size_stake_account",
                    format!(
                        "{} < {} + {}",
                        ctx.accounts.stake_account_from.get_lamports(),
                        claim,
                        minimal_size_stake_account(&stake_from_meta, &ctx.accounts.config)
                    ),
                )));
        }

        let tree_node_hash = tree_node.hash().to_bytes();
        if !merkle_proof::verify(
            proof,
            ctx.accounts.settlement.merkle_root,
            hash_leaf!(tree_node_hash).to_bytes(),
        ) {
            return Err(error!(ErrorCode::ClaimSettlementProofFailed).with_values((
                "Merkle proof verification failed",
                format!("Tree node: {:?}, hash: {}", tree_node, tree_node.hash()),
            )));
        }

        withdraw(
            CpiContext::new_with_signer(
                ctx.accounts.stake_program.to_account_info(),
                Withdraw {
                    stake: ctx.accounts.stake_account_from.to_account_info(),
                    withdrawer: ctx.accounts.bonds_withdrawer_authority.to_account_info(),
                    to: ctx.accounts.stake_account_to.to_account_info(),
                    clock: ctx.accounts.clock.to_account_info(),
                    stake_history: ctx.accounts.stake_history.to_account_info(),
                },
                &[&[
                    BONDS_WITHDRAWER_AUTHORITY_SEED,
                    &ctx.accounts.config.key().as_ref(),
                    &[ctx.accounts.config.bonds_withdrawer_authority_bump],
                ]],
            ),
            claim,
            None,
        )?;

        ctx.accounts.settlement.lamports_claimed += claim;
        ctx.accounts.settlement.merkle_nodes_claimed += 1;

        emit_cpi!(ClaimSettlementV2Event {
            settlement: ctx.accounts.settlement.key(),
            settlement_epoch: ctx.accounts.settlement.epoch_created_for,
            stake_account_to: ctx.accounts.stake_account_to.key(),
            settlement_lamports_claimed: U64ValueChange {
                old: ctx.accounts.settlement.lamports_claimed - claim,
                new: ctx.accounts.settlement.lamports_claimed
            },
            settlement_merkle_nodes_claimed: ctx.accounts.settlement.merkle_nodes_claimed,
            stake_account_staker,
            stake_account_withdrawer,
            amount: claim,
            index,
        });

        Ok(())
    }
}
