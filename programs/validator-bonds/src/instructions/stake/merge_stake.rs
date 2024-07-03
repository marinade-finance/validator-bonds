use crate::checks::get_delegation;
use crate::constants::{BONDS_WITHDRAWER_AUTHORITY_SEED, SETTLEMENT_STAKER_AUTHORITY_SEED};
use crate::error::ErrorCode;
use crate::events::stake::MergeStakeEvent;
use crate::state::config::{find_bonds_withdrawer_authority, Config};
use crate::state::settlement::find_settlement_staker_authority;

use anchor_lang::{
    prelude::*,
    solana_program::{program::invoke_signed, stake::instruction::merge, sysvar::stake_history},
};
use anchor_spl::stake::{Stake, StakeAccount};

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct MergeStakeArgs {
    pub settlement: Pubkey,
}

#[event_cpi]
#[derive(Accounts)]
pub struct MergeStake<'info> {
    /// the config account under which the bond was created
    pub config: Account<'info, Config>,

    #[account(
        mut,
        constraint = source_stake.key() != destination_stake.key() @ ErrorCode::MergeMismatchSameSourceDestination
    )]
    pub source_stake: Account<'info, StakeAccount>,

    #[account(mut)]
    pub destination_stake: Account<'info, StakeAccount>,

    /// CHECK: checked within the code
    /// bonds program authority PDA address: settlement staker or bonds withdrawer
    pub staker_authority: UncheckedAccount<'info>,

    /// CHECK: have no CPU budget to parse
    #[account(address = stake_history::ID)]
    pub stake_history: UncheckedAccount<'info>,

    pub clock: Sysvar<'info, Clock>,

    pub stake_program: Program<'info, Stake>,
}

impl<'info> MergeStake<'info> {
    pub fn process(
        ctx: Context<MergeStake>,
        MergeStakeArgs { settlement }: MergeStakeArgs,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, ErrorCode::ProgramIsPaused);

        let destination_meta =
            ctx.accounts.destination_stake.meta().ok_or(
                error!(ErrorCode::UninitializedStake).with_account_name("destination_stake"),
            )?;
        let source_meta = ctx
            .accounts
            .source_stake
            .meta()
            .ok_or(error!(ErrorCode::UninitializedStake).with_account_name("source_stake"))?;

        // staker authorities has to match each other, intentional not permitting to pass stake account merge authority
        if destination_meta.authorized.staker != ctx.accounts.staker_authority.key() {
            return Err(error!(ErrorCode::StakerAuthorityMismatch)
                .with_account_name("destination_stake")
                .with_pubkeys((
                    destination_meta.authorized.staker,
                    ctx.accounts.staker_authority.key(),
                )));
        }
        if source_meta.authorized.staker != ctx.accounts.staker_authority.key() {
            return Err(error!(ErrorCode::StakerAuthorityMismatch)
                .with_account_name("source_stake")
                .with_pubkeys((
                    source_meta.authorized.staker,
                    ctx.accounts.staker_authority.key(),
                )));
        }

        // withdrawer authorities must belong to the bonds program (bonds program ownership)
        let (bonds_withdrawer_authority, _) =
            find_bonds_withdrawer_authority(&ctx.accounts.config.key());
        if source_meta.authorized.withdrawer != bonds_withdrawer_authority
            || destination_meta.authorized.withdrawer != bonds_withdrawer_authority
        {
            return Err(error!(ErrorCode::NonBondStakeAuthorities)
                .with_account_name("source_stake/destination_stake")
                .with_values((
                    "bonds_withdrawer_authority/source_stake_withdrawer/destination_stake_withdrawer",
                    format!("{}/{}/{}", bonds_withdrawer_authority, source_meta.authorized.withdrawer, destination_meta.authorized.withdrawer)
                ))
                );
        }

        let destination_delegation = get_delegation(&ctx.accounts.destination_stake)?;
        let source_delegation = get_delegation(&ctx.accounts.source_stake)?;
        // the stakes have to be both non-delegated or both delegated to the same vote account
        if destination_delegation.map_or_else(|| None, |p| Some(p.voter_pubkey))
            != source_delegation.map_or_else(|| None, |p| Some(p.voter_pubkey))
        {
            return Err(error!(ErrorCode::StakeDelegationMismatch).with_values((
                "source_stake/destination_stake",
                format!("{:?}/{:?}", source_delegation, destination_delegation),
            )));
        }

        let (settlement_staker_authority, settlement_bump) =
            find_settlement_staker_authority(&settlement);

        let merge_instruction = &merge(
            &ctx.accounts.destination_stake.key(),
            &ctx.accounts.source_stake.key(),
            &ctx.accounts.staker_authority.key(),
        )[0];
        let merge_account_infos = &[
            ctx.accounts.stake_program.to_account_info(),
            ctx.accounts.destination_stake.to_account_info(),
            ctx.accounts.source_stake.to_account_info(),
            ctx.accounts.clock.to_account_info(),
            ctx.accounts.stake_history.to_account_info(),
            ctx.accounts.staker_authority.to_account_info(),
        ];
        if ctx.accounts.staker_authority.key() == bonds_withdrawer_authority {
            invoke_signed(
                merge_instruction,
                merge_account_infos,
                &[&[
                    BONDS_WITHDRAWER_AUTHORITY_SEED,
                    &ctx.accounts.config.key().as_ref(),
                    &[ctx.accounts.config.bonds_withdrawer_authority_bump],
                ]],
            )?
        } else if ctx.accounts.staker_authority.key() == settlement_staker_authority {
            invoke_signed(
                merge_instruction,
                merge_account_infos,
                &[&[
                    SETTLEMENT_STAKER_AUTHORITY_SEED,
                    &settlement.as_ref(),
                    &[settlement_bump],
                ]],
            )?
        } else {
            return Err(error!(ErrorCode::StakerAuthorityMismatch)
                .with_account_name("staker_authority")
                .with_values((
                    "accounts.staker_authority [bonds_withdrawer_authority/settlement_staker_authority]",
                    format!(
                        "{} [{}/{}]",
                        ctx.accounts.staker_authority.key(),
                        bonds_withdrawer_authority,
                        settlement_staker_authority
                    ),
                )));
        };

        emit_cpi!(MergeStakeEvent {
            config: ctx.accounts.config.key(),
            staker_authority: ctx.accounts.staker_authority.key(),
            destination_stake: ctx.accounts.destination_stake.key(),
            destination_delegation: destination_delegation.map(Into::into),
            source_stake: ctx.accounts.source_stake.key(),
            source_delegation: source_delegation.map(Into::into),
        });

        Ok(())
    }
}
