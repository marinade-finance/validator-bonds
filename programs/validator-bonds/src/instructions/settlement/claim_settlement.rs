use crate::checks::{
    check_stake_is_initialized_with_withdrawer_authority, check_stake_valid_delegation,
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
use anchor_lang::solana_program::sysvar::stake_history;
use anchor_lang::system_program::ID as system_program_id;
use anchor_spl::stake::{withdraw, Stake, StakeAccount, Withdraw};

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct ClaimSettlementArgs {
    pub amount: u64,
    pub proof: Vec<[u8; 32]>,
    // staker authority
    pub staker: Pubkey,
    /// claim holder, withdrawer_authority
    pub withdrawer: Pubkey,
    pub vote_account: Pubkey,
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
        constraint = bond.validator_vote_account == params.vote_account @ ErrorCode::VoteAccountMismatch,
        seeds = [
            b"bond_account",
            config.key().as_ref(),
            params.vote_account.as_ref(),
        ],
        bump = bond.bump,
    )]
    bond: Account<'info, Bond>,

    #[account(
        mut,
        has_one = bond @ ErrorCode::ConfigAccountMismatch,
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

    /// deduplication, one amount cannot be claimed twice
    #[account(
        init,
        payer = rent_payer,
        space = 8 + std::mem::size_of::<SettlementClaim>(),
        seeds = [
            b"claim_account",
            settlement.key().as_ref(),
            params.staker.as_ref(),
            params.withdrawer.as_ref(),
            params.vote_account.as_ref(),
            params.claim.to_le_bytes().as_ref(),
        ],
        bump,
    )]
    settlement_claim: Account<'info, SettlementClaim>,

    /// a stake account which will be withdrawn
    #[account(mut)]
    stake_account: Box<Account<'info, StakeAccount>>,

    /// CHECK: verification within merkle proof
    /// account that will receive the funds on this claim
    #[account(
       mut,
       constraint = params.withdrawer == withdrawer_authority.key(),
    )]
    withdrawer_authority: UncheckedAccount<'info>,

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
        ClaimSettlementArgs {
            amount,
            proof,
            staker: staker_authority,
            withdrawer: withdrawer_authority,
            vote_account,
            claim,
        }: ClaimSettlementArgs,
        settlement_claim_bump: u8,
    ) -> Result<()> {
        if self.settlement.total_funds_claimed + amount > self.settlement.max_total_claim {
            return Err(error!(ErrorCode::ClaimAmountExceedsMaxTotalClaim)
                .with_values(("amount", amount))
                .with_values(("max_total_claim", self.settlement.max_total_claim)));
        }
        if self.settlement.num_nodes_claimed + 1 > self.settlement.max_num_nodes {
            return Err(error!(ErrorCode::ClaimCountExceedsMaxNumNodes)
                .with_values(("settlement", self.settlement.key()))
                .with_values(("num_nodes_claimed", self.settlement.num_nodes_claimed))
                .with_values(("max_num_nodes", self.settlement.max_num_nodes)));
        }

        // stake account is managed by bonds program
        let stake_meta = check_stake_is_initialized_with_withdrawer_authority(
            &self.stake_account,
            &self.bonds_withdrawer_authority.key(),
            "stake_account",
        )?;
        // stake account is delegated (deposited by) the bond validator
        check_stake_valid_delegation(&self.stake_account, &self.bond.validator_vote_account)?;
        // provided stake account must be funded; staker == settlement staker authority
        require_keys_eq!(
            stake_meta.authorized.staker,
            self.settlement.settlement_authority,
            ErrorCode::StakeAccountNotFunded,
        );

        // provided stake account has to be big enough to cover the claim and still be valid to exist
        // it's responsibility of the SDK to merge the stake accounts if needed
        //   - the invariant here is that the stake account will be always rent exempt + min size
        //     this has to be ensured by fund_settlement instruction
        if self.stake_account.get_lamports()
            < amount + minimal_size_stake_account(&stake_meta, &self.config)
        {
            return Err(error!(ErrorCode::ClaimingStakeAccountLamportsInsufficient)
                .with_account_name("stake_account")
                .with_values(("stake_account_lamports", self.stake_account.get_lamports()))
                .with_values(("claiming_amount", amount))
                .with_values((
                    "minimal_size_stake_account",
                    minimal_size_stake_account(&stake_meta, &self.config),
                )));
        }

        let merkle_tree_node =
            merkle_proof::tree_node(staker_authority, withdrawer_authority, vote_account, claim);

        if !merkle_proof::verify(proof, self.settlement.merkle_root, merkle_tree_node) {
            return Err(error!(ErrorCode::ClaimSettlementProofFailed)
                .with_values(("claiming_amount", amount))
                .with_values(("withdrawer_authority", withdrawer_authority.key())));
        }

        self.settlement_claim.set_inner(SettlementClaim {
            settlement: self.settlement.key(),
            staker_authority,
            withdrawer_authority,
            vote_account,
            claim,
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
                    to: self.withdrawer_authority.to_account_info(),
                    clock: self.clock.to_account_info(),
                    stake_history: self.stake_history.to_account_info(),
                },
                &[&[
                    BONDS_AUTHORITY_SEED,
                    &self.config.key().as_ref(),
                    &[self.config.bonds_withdrawer_authority_bump],
                ]],
            ),
            amount,
            None,
        )?;

        self.settlement.total_funds_claimed += amount;
        self.settlement.num_nodes_claimed += 1;

        emit!(ClaimSettlementEvent {
            settlement: self.settlement_claim.settlement,
            settlement_claim: self.settlement_claim.key(),
            staker_authority: self.settlement_claim.staker_authority,
            vote_account: self.settlement_claim.vote_account,
            withdrawer_authority: self.settlement_claim.withdrawer_authority,
            claim: self.settlement_claim.claim,
            rent_collector: self.settlement_claim.rent_collector,
            bump: settlement_claim_bump,
        });

        Ok(())
    }
}
