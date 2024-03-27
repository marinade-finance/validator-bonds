use crate::checks::{
    check_stake_is_initialized_with_withdrawer_authority, check_stake_is_not_locked,
};
use crate::constants::BONDS_WITHDRAWER_AUTHORITY_SEED;
use crate::error::ErrorCode;
use crate::events::settlement_claim::ClaimSettlementEvent;
use crate::events::U64ValueChange;
use crate::state::bond::Bond;
use crate::state::config::Config;
use crate::state::settlement::Settlement;
use crate::state::settlement_claim::SettlementClaim;
use crate::utils::{merkle_proof, minimal_size_stake_account};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use anchor_lang::solana_program::sysvar::stake_history;
use anchor_spl::stake::{withdraw, Stake, StakeAccount, Withdraw};
use merkle_tree::psr_claim::TreeNode;
use merkle_tree::{hash_leaf, LEAF_PREFIX};

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct ClaimSettlementArgs {
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
}

/// Claims a settlement by withdrawing settlement funded stake account
#[derive(Accounts)]
#[instruction(params: ClaimSettlementArgs)]
pub struct ClaimSettlement<'info> {
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
        init,
        payer = rent_payer,
        space = 8 + std::mem::size_of::<SettlementClaim>(),
        seeds = [
            b"claim_account",
            settlement.key().as_ref(),
            params.tree_node_hash.as_ref(),
        ],
        bump,
    )]
    pub settlement_claim: Account<'info, SettlementClaim>,

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

    /// upon claiming, a claim account is created to confirm the occurrence of the claim
    /// when the settlement withdrawal window expires, the claim account is closed, and the rent is refunded here
    #[account(
        mut,
        owner = system_program.key()
    )]
    pub rent_payer: Signer<'info>,

    pub system_program: Program<'info, System>,

    /// CHECK: have no CPU budget to parse
    #[account(address = stake_history::ID)]
    pub stake_history: UncheckedAccount<'info>,

    pub clock: Sysvar<'info, Clock>,

    pub stake_program: Program<'info, Stake>,
}

impl<'info> ClaimSettlement<'info> {
    pub fn process(
        &mut self,
        ClaimSettlementArgs {
            proof,
            tree_node_hash: tree_node_hash_args,
            claim,
            stake_account_staker,
            stake_account_withdrawer,
        }: ClaimSettlementArgs,
        settlement_claim_bump: u8,
    ) -> Result<()> {
        require!(!self.config.paused, ErrorCode::ProgramIsPaused);

        // settlement_claim PDA address verification
        let tree_node = TreeNode {
            stake_authority: stake_account_staker,
            withdraw_authority: stake_account_withdrawer.key(),
            claim,
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

        if self.settlement.lamports_claimed + claim > self.settlement.max_total_claim {
            return Err(error!(ErrorCode::ClaimAmountExceedsMaxTotalClaim)
                .with_account_name("settlement")
                .with_values((
                    "lamports_claimed + claim > max_total_claim",
                    format!(
                        "{} + {} <= {}",
                        self.settlement.lamports_claimed, claim, self.settlement.max_total_claim
                    ),
                )));
        }
        if self.settlement.merkle_nodes_claimed + 1 > self.settlement.max_merkle_nodes {
            return Err(error!(ErrorCode::ClaimCountExceedsMaxMerkleNodes)
                .with_account_name("settlement")
                .with_values((
                    "merkle_nodes_claimed + 1 > max_merkle_nodes",
                    format!(
                        "{} + 1 <= {}",
                        self.settlement.merkle_nodes_claimed, self.settlement.max_merkle_nodes
                    ),
                )));
        }

        // stake account is managed by bonds program
        let stake_from_meta = check_stake_is_initialized_with_withdrawer_authority(
            &self.stake_account_from,
            &self.bonds_withdrawer_authority.key(),
            "stake_account_from",
        )?;
        // provided stake account "from" must be funded; staker == settlement staker authority
        require_keys_eq!(
            stake_from_meta.authorized.staker,
            self.settlement.staker_authority,
            ErrorCode::StakeAccountNotFundedToSettlement,
        );

        // stake account "to" for withdrawing funds to has to match merkle proof data
        let stake_to_meta = check_stake_is_initialized_with_withdrawer_authority(
            &self.stake_account_to,
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
        check_stake_is_not_locked(&self.stake_account_to, &self.clock, "stake_account_to")?;

        // The provided stake account must be sufficiently large to cover the claim while remaining valid.
        // It is the SDK's responsibility to merge stake accounts if necessary.
        // - The invariant is that the stake account will always be rent-exempt and of minimum size.
        //   This must be ensured by the fund_settlement instruction.
        if self.stake_account_from.get_lamports()
            < claim + minimal_size_stake_account(&stake_from_meta, &self.config)
        {
            return Err(error!(ErrorCode::ClaimingStakeAccountLamportsInsufficient)
                .with_account_name("stake_account_from")
                .with_values((
                    "stake_account_from_lamports < claim_amount + minimal_size_stake_account",
                    format!(
                        "{} < {} + {}",
                        self.stake_account_from.get_lamports(),
                        claim,
                        minimal_size_stake_account(&stake_from_meta, &self.config)
                    ),
                )));
        }

        let tree_node_hash = tree_node.hash().to_bytes();
        if !merkle_proof::verify(
            proof,
            self.settlement.merkle_root,
            hash_leaf!(tree_node_hash).to_bytes(),
        ) {
            return Err(error!(ErrorCode::ClaimSettlementProofFailed).with_values((
                "Merkle proof verification failed",
                format!("Tree node: {:?}", tree_node),
            )));
        }

        self.settlement_claim.set_inner(SettlementClaim {
            settlement: self.settlement.key(),
            stake_account_to: self.stake_account_to.key(),
            stake_account_staker,
            stake_account_withdrawer,
            amount: claim,
            bump: settlement_claim_bump,
            rent_collector: self.rent_payer.key(),
            reserved: [0; 93],
        });

        withdraw(
            CpiContext::new_with_signer(
                self.stake_program.to_account_info(),
                Withdraw {
                    stake: self.stake_account_from.to_account_info(),
                    withdrawer: self.bonds_withdrawer_authority.to_account_info(),
                    to: self.stake_account_to.to_account_info(),
                    clock: self.clock.to_account_info(),
                    stake_history: self.stake_history.to_account_info(),
                },
                &[&[
                    BONDS_WITHDRAWER_AUTHORITY_SEED,
                    &self.config.key().as_ref(),
                    &[self.config.bonds_withdrawer_authority_bump],
                ]],
            ),
            claim,
            None,
        )?;

        self.settlement.lamports_claimed += claim;
        self.settlement.merkle_nodes_claimed += 1;

        emit!(ClaimSettlementEvent {
            settlement: self.settlement_claim.settlement,
            settlement_claim: self.settlement_claim.key(),
            stake_account_to: self.settlement_claim.stake_account_to,
            settlement_lamports_claimed: U64ValueChange {
                old: self.settlement.lamports_claimed - claim,
                new: self.settlement.lamports_claimed
            },
            settlement_merkle_nodes_claimed: self.settlement.merkle_nodes_claimed,
            stake_account_staker: self.settlement_claim.stake_account_staker,
            stake_account_withdrawer: self.settlement_claim.stake_account_withdrawer,
            amount: self.settlement_claim.amount,
            rent_collector: self.settlement_claim.rent_collector,
        });

        Ok(())
    }
}
