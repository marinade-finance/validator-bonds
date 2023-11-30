use crate::constants::{BONDS_AUTHORITY_SEED, SETTLEMENT_AUTHORITY_SEED};
use crate::error::ErrorCode;
use crate::events::stake::MergeEvent;
use crate::state::config::{find_bonds_withdrawer_authority, Config};
use crate::state::settlement::find_settlement_authority;
use crate::ID;
use anchor_lang::{
    prelude::*,
    solana_program::{program::invoke_signed, stake::instruction::merge, sysvar::stake_history},
};
use anchor_spl::stake::{Stake, StakeAccount};

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct MergeArgs {
    pub settlement: Pubkey,
}

#[derive(Accounts)]
pub struct Merge<'info> {
    /// the config root account under which the bond was created
    #[account()]
    config: Account<'info, Config>,

    #[account(mut)]
    source_stake: Account<'info, StakeAccount>,

    #[account(mut)]
    destination_stake: Account<'info, StakeAccount>,

    /// CHECK: staker authority defined here has to be owned by program, then checked within the code
    #[account(
        owner = ID
    )]
    staker_authority: UncheckedAccount<'info>,

    /// CHECK: have no CPU budget to parse
    #[account(address = stake_history::ID)]
    stake_history: UncheckedAccount<'info>,

    clock: Sysvar<'info, Clock>,

    stake_program: Program<'info, Stake>,
}

impl<'info> Merge<'info> {
    pub fn process(&mut self, MergeArgs { settlement }: MergeArgs) -> Result<()> {
        let destination_meta = self
            .destination_stake
            .meta()
            .ok_or(error!(ErrorCode::UninitializedStake).with_account_name("destination_stake"))?;
        let source_meta = self
            .source_stake
            .meta()
            .ok_or(error!(ErrorCode::UninitializedStake).with_account_name("source_stake"))?;

        if destination_meta.authorized.staker != self.staker_authority.key() {
            return Err(error!(ErrorCode::StakerAuthorityMismatch)
                .with_pubkeys((
                    destination_meta.authorized.staker,
                    self.staker_authority.key(),
                ))
                .with_account_name("destination_stake"));
        }
        if source_meta.authorized.staker != self.staker_authority.key() {
            return Err(error!(ErrorCode::StakerAuthorityMismatch)
                .with_pubkeys((source_meta.authorized.staker, self.staker_authority.key()))
                .with_account_name("source_stake"));
        }

        // this program provides only limited set of staker authorities to sign
        let (bonds_authority, _) = find_bonds_withdrawer_authority(&self.config.key());
        let (settlement_authority, settlement_bump) = find_settlement_authority(&settlement);

        let destination_delegation = self.destination_stake.delegation();
        let source_delegation = self.source_stake.delegation();
        // by design the stakes have to be delegated and to the same validator vote accounts
        if destination_delegation.is_none()
            || source_delegation.is_none()
            || destination_delegation.unwrap().voter_pubkey
                != source_delegation.unwrap().voter_pubkey
        {
            return Err(error!(ErrorCode::StakeDelegationMismatch)
                .with_values((
                    "destination_stake_delegation",
                    if let Some(dest) = destination_delegation {
                        dest.voter_pubkey.to_string()
                    } else {
                        "none".to_string()
                    },
                ))
                .with_values((
                    "source_stake_delegation",
                    if let Some(src) = source_delegation {
                        src.voter_pubkey.to_string()
                    } else {
                        "none".to_string()
                    },
                )));
        }

        let merge_instruction = &merge(
            &self.destination_stake.key(),
            &self.source_stake.key(),
            &self.staker_authority.key(),
        )[0];
        let merge_account_infos = &[
            self.stake_program.to_account_info(),
            self.destination_stake.to_account_info(),
            self.source_stake.to_account_info(),
            self.clock.to_account_info(),
            self.stake_history.to_account_info(),
            self.staker_authority.to_account_info(),
        ];
        if self.staker_authority.key() == bonds_authority {
            invoke_signed(
                merge_instruction,
                merge_account_infos,
                &[&[
                    BONDS_AUTHORITY_SEED,
                    &self.config.key().as_ref(),
                    &[self.config.bonds_withdrawer_authority_bump],
                ]],
            )?
        } else if self.staker_authority.key() == settlement_authority {
            invoke_signed(
                merge_instruction,
                merge_account_infos,
                &[&[
                    SETTLEMENT_AUTHORITY_SEED,
                    &self.config.key().as_ref(),
                    &[settlement_bump],
                ]],
            )?
        } else {
            return Err(error!(ErrorCode::StakerAuthorityMismatch)
                .with_account_name("staker_authority")
                .with_values(("staker_authority", self.staker_authority.key()))
                .with_values(("bonds_authority", bonds_authority))
                .with_values(("settlement_authority", settlement_authority)));
        };

        emit!(MergeEvent {
            config: self.config.key(),
            staker_authority: self.staker_authority.key(),
            destination_stake: self.destination_stake.key(),
            destination_delegation: destination_delegation.map(Into::into),
            source_stake: self.source_stake.key(),
            source_delegation: source_delegation.map(Into::into),
        });

        Ok(())
    }
}
