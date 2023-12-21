use crate::error::ErrorCode;
use crate::events::settlement::InitSettlementEvent;
use crate::state::bond::Bond;
use crate::state::config::Config;
use crate::state::settlement::{find_settlement_authority, Bumps, Settlement};
use crate::state::Reserved150;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_program;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct InitSettlementArgs {
    pub merkle_root: [u8; 32],
    pub vote_account: Pubkey,
    pub settlement_total_claim: u64,
    pub settlement_num_nodes: u64,
    pub rent_collector: Pubkey,
}

/// Creates settlement account for the bond, only operator authority can create the account
#[derive(Accounts)]
#[instruction(params: InitSettlementArgs)]
pub struct InitSettlement<'info> {
    #[account(
        has_one = operator_authority @ ErrorCode::InvalidOperatorAuthority,
    )]
    config: Account<'info, Config>,

    #[account(
        has_one = config @ ErrorCode::ConfigAccountMismatch,
        seeds = [
            b"bond_account",
            config.key().as_ref(),
            params.vote_account.as_ref()
        ],
        bump = bond.bump,
    )]
    bond: Account<'info, Bond>,

    #[account(
        init,
        payer = rent_payer,
        space = 8 + std::mem::size_of::<Settlement>(),
        seeds = [
            b"settlement_account",
            bond.key().as_ref(),
            params.merkle_root.as_ref(),
            clock.epoch.to_le_bytes().as_ref(),
        ],
        bump,
    )]
    settlement: Account<'info, Settlement>,

    /// operator signer authority that is allowed to create the settlement account
    operator_authority: Signer<'info>,

    /// rent exempt payer of account creation
    #[account(
        mut,
        owner = system_program::ID
    )]
    rent_payer: Signer<'info>,

    clock: Sysvar<'info, Clock>,

    system_program: Program<'info, System>,
}

impl<'info> InitSettlement<'info> {
    pub fn process(
        &mut self,
        InitSettlementArgs {
            merkle_root,
            vote_account,
            rent_collector,
            settlement_total_claim,
            settlement_num_nodes,
        }: InitSettlementArgs,
        settlement_bump: u8,
    ) -> Result<()> {
        require!(true == false, ErrorCode::NotYetImplemented);

        if settlement_total_claim == 0 || settlement_num_nodes == 0 {
            return Err(error!(ErrorCode::EmptySettlementMerkleTree)
                .with_values(("settlement_total_claim", settlement_total_claim))
                .with_values(("settlement_num_nodes", settlement_num_nodes)));
        }

        let (settlement_authority, settlement_authority_bump) =
            find_settlement_authority(&self.settlement.key());
        self.settlement.set_inner(Settlement {
            bond: self.bond.key(),
            settlement_authority,
            merkle_root,
            max_total_claim: settlement_total_claim,
            max_num_nodes: settlement_num_nodes,
            total_funded: 0,
            total_funds_claimed: 0,
            num_nodes_claimed: 0,
            epoch_created_at: self.clock.epoch,
            rent_collector,
            split_rent_collector: None,
            split_rent_amount: 0,
            bumps: Bumps {
                pda: settlement_bump,
                authority: settlement_authority_bump,
            },
            reserved: Reserved150::default(),
        });
        emit!(InitSettlementEvent {
            bond: self.settlement.bond,
            vote_account,
            settlement_authority: self.settlement.settlement_authority,
            merkle_root: self.settlement.merkle_root,
            max_total_claim: self.settlement.max_total_claim,
            max_num_nodes: self.settlement.max_num_nodes,
            epoch: self.settlement.epoch_created_at,
            rent_collector: self.settlement.rent_collector,
            bumps: self.settlement.bumps.clone(),
        });

        Ok(())
    }
}
