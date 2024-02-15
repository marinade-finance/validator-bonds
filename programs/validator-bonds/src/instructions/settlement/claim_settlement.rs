use crate::checks::{
    check_stake_is_initialized_with_withdrawer_authority, check_stake_is_not_locked,
    check_stake_valid_delegation,
};
use crate::constants::BONDS_AUTHORITY_SEED;
use crate::error::ErrorCode;
use crate::events::settlement_claim::ClaimSettlementEvent;
use crate::state::bond::Bond;
use crate::state::config::Config;
use crate::state::settlement::Settlement;
use crate::state::settlement_claim::SettlementClaim;
use crate::state::Reserved150;
use crate::utils::{merkle_proof, minimal_size_stake_account};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use anchor_lang::solana_program::sysvar::stake_history;
use anchor_lang::system_program::ID as system_program_id;
use anchor_spl::stake::{withdraw, Stake, StakeAccount, Withdraw};
use merkle_tree::insurance_engine::TreeNode;
use merkle_tree::{hash_leaf, LEAF_PREFIX};

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct ClaimSettlementArgs {
    pub proof: Vec<[u8; 32]>,
    /// claim amount; merkle root verification
    pub claim: u64,
}

#[derive(Accounts)]
#[instruction(params: ClaimSettlementArgs)]
pub struct ClaimSettlement<'info> {
    /// the config root account under which the settlement was created
    #[account()]
    config: Box<Account<'info, Config>>,

    #[account(
        has_one = config @ ErrorCode::ConfigAccountMismatch,
        seeds = [
            b"bond_account",
            config.key().as_ref(),
            bond.vote_account.as_ref(),
        ],
        bump = bond.bump,
    )]
    bond: Account<'info, Bond>,

    #[account(
        mut,
        has_one = bond @ ErrorCode::BondAccountMismatch,
        constraint = settlement.epoch_created_at + config.epochs_to_claim_settlement >= clock.epoch @ ErrorCode::SettlementExpired,
        seeds = [
            b"settlement_account",
            bond.key().as_ref(),
            settlement.merkle_root.as_ref(),
            settlement.epoch_created_at.to_le_bytes().as_ref(),
        ],
        bump = settlement.bumps.pda,
    )]
    settlement: Account<'info, Settlement>,

    // TODO: verify in test that the claim account is created with the right bump and cannot be created with other bump
    // TODO: verify that understanding of the TreeNode values is correct
    /// deduplication, one amount cannot be claimed twice
    // INFO: IDL generation generates WARNING: unexpected seed category for var: SeedPath("merkle_proof :: TreeNode { stake_authority : bonds_withdrawer_authority", [])
    //       https://github.com/coral-xyz/anchor/issues/1550
    #[account(
        init,
        payer = rent_payer,
        space = 8 + std::mem::size_of::<SettlementClaim>(),
        seeds = [
            b"claim_account",
            settlement.key().as_ref(),
            TreeNode {
                stake_authority: bonds_withdrawer_authority.key().to_string(),
                withdraw_authority: withdraw_authority.key().to_string(),
                vote_account: bond.vote_account.key().to_string(),
                claim: params.claim,
                proof: None,
            }.hash().to_bytes().as_ref(),
        ],
        bump,
    )]
    settlement_claim: Account<'info, SettlementClaim>,

    /// a stake account which will be withdrawn
    #[account(mut)]
    stake_account: Box<Account<'info, StakeAccount>>,

    /// CHECK: verification within merkle proof
    /// account that will receive the funds on this claim
    #[account(mut)]
    withdraw_authority: UncheckedAccount<'info>,

    /// CHECK: PDA
    /// authority that manages (owns == being withdrawer authority) all stakes account under the bonds program
    #[account(
        seeds = [
            b"bonds_authority",
            config.key().as_ref(),
        ],
        bump = config.bonds_withdrawer_authority_bump
    )]
    bonds_withdrawer_authority: UncheckedAccount<'info>,

    /// On claiming it's created a claim account that confirms the claim has happened
    /// when the settlement withdrawal window expires the claim account is closed and rent gets back
    #[account(
        mut,
        owner = system_program_id
    )]
    rent_payer: Signer<'info>,

    system_program: Program<'info, System>,

    /// CHECK: have no CPU budget to parse
    #[account(address = stake_history::ID)]
    stake_history: UncheckedAccount<'info>,

    clock: Sysvar<'info, Clock>,

    stake_program: Program<'info, Stake>,
}

impl<'info> ClaimSettlement<'info> {
    pub fn process(
        &mut self,
        ClaimSettlementArgs { proof, claim }: ClaimSettlementArgs,
        settlement_claim_bump: u8,
    ) -> Result<()> {
        // settlement_claim PDA address verification
        let tree_node = TreeNode {
            stake_authority: self.bonds_withdrawer_authority.key().to_string(),
            withdraw_authority: self.withdraw_authority.key().to_string(),
            vote_account: self.bond.vote_account.key().to_string(),
            claim,
            proof: None,
        };
        if self.settlement.lamports_claimed + claim > self.settlement.max_total_claim {
            return Err(error!(ErrorCode::ClaimAmountExceedsMaxTotalClaim)
                .with_account_name("settlement")
                .with_values((
                    "total_funds_claimed + claim_amount > max_total_claim",
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
        let stake_meta = check_stake_is_initialized_with_withdrawer_authority(
            &self.stake_account,
            &self.bonds_withdrawer_authority.key(),
            "stake_account",
        )?;
        // provided stake account must be funded; staker == settlement staker authority
        require_keys_eq!(
            stake_meta.authorized.staker,
            self.settlement.authority,
            ErrorCode::StakeAccountNotFundedToSettlement,
        );
        // stake account is delegated (deposited by) the bond validator
        check_stake_valid_delegation(&self.stake_account, &self.bond.vote_account)?;
        // stake account cannot be locked (constraints do not permit a correctly set-up account being locked)
        check_stake_is_not_locked(&self.stake_account, &self.clock, "stake_account")?;

        // provided stake account has to be big enough to cover the claim and still be valid to exist
        // responsibility of the SDK to merge the stake accounts if needed
        //   - the invariant here is that the stake account will be always rent exempt + min size
        //     this has to be ensured by fund_settlement instruction
        if self.stake_account.get_lamports()
            < claim + minimal_size_stake_account(&stake_meta, &self.config)
        {
            return Err(error!(ErrorCode::ClaimingStakeAccountLamportsInsufficient)
                .with_account_name("stake_account")
                .with_values((
                    "stake_account_lamports < claim_amount + minimal_size_stake_account",
                    format!(
                        "{} < {} + {}",
                        self.stake_account.get_lamports(),
                        claim,
                        minimal_size_stake_account(&stake_meta, &self.config)
                    ),
                )));
        }

        let tree_node_hash = tree_node.hash().to_bytes();
        if !merkle_proof::verify(
            proof,
            self.settlement.merkle_root,
            hash_leaf!(tree_node_hash).to_bytes(),
        ) {
            // TODO: change for correct staker_authority
            msg!("Merkle proof verification failed. Merkle tree node: {:?}, staker_authority: {}, withdrawer_authority: {}, vote_account: {}, claim_amount: {}",
                tree_node, self.bonds_withdrawer_authority.key(), self.withdraw_authority.key(), self.bond.vote_account.key(), claim);
            return err!(ErrorCode::ClaimSettlementProofFailed);
        }

        self.settlement_claim.set_inner(SettlementClaim {
            settlement: self.settlement.key(),
            stake_authority: self.bonds_withdrawer_authority.key(),
            withdraw_authority: self.withdraw_authority.key(),
            vote_account: self.bond.vote_account.key(),
            amount: claim,
            bump: settlement_claim_bump,
            rent_collector: self.rent_payer.key(),
            reserved: Reserved150::default(),
        });

        withdraw(
            CpiContext::new_with_signer(
                self.stake_program.to_account_info(),
                Withdraw {
                    stake: self.stake_account.to_account_info(),
                    withdrawer: self.bonds_withdrawer_authority.to_account_info(),
                    to: self.withdraw_authority.to_account_info(),
                    clock: self.clock.to_account_info(),
                    stake_history: self.stake_history.to_account_info(),
                },
                &[&[
                    BONDS_AUTHORITY_SEED,
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
            settlement_lamports_claimed: self.settlement.lamports_claimed,
            settlement_merkle_nodes_claimed: self.settlement.merkle_nodes_claimed,
            vote_account: self.settlement_claim.vote_account,
            withdraw_authority: self.settlement_claim.withdraw_authority,
            amount: self.settlement_claim.amount,
            rent_collector: self.settlement_claim.rent_collector,
            bump: settlement_claim_bump,
        });

        Ok(())
    }
}
