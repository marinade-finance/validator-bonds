use crate::constants::MIN_STAKE_LAMPORTS;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::stake::state::Meta;
use anchor_spl::stake::{withdraw, Stake, StakeAccount, Withdraw};

/// This method serves to close/remove the stake account that has been just created
/// and it's not initialized.
/// This returns back the rent reserve of unused stake account
/// when the spil stake account is not used for withdrawing, funding settlement...
pub fn return_unused_split_stake_account_rent<'info>(
    stake_program: &Program<'info, Stake>,
    split_stake_account: &Account<'info, StakeAccount>,
    rent_collector: &AccountInfo<'info>,
    clock: &Sysvar<'info, Clock>,
    stake_history: &AccountInfo<'info>,
) -> Result<()> {
    withdraw(
        CpiContext::new(
            stake_program.to_account_info(),
            Withdraw {
                stake: split_stake_account.to_account_info(),
                // the withdrawer authority (owner) of an uninitialized stake account is the stake account itself
                withdrawer: split_stake_account.to_account_info(),
                to: rent_collector.to_account_info(),
                clock: clock.to_account_info(),
                stake_history: stake_history.to_account_info(),
            },
        ),
        split_stake_account.get_lamports(),
        None,
    )
}

pub fn minimal_size_stake_account(stake_meta: &Meta) -> u64 {
    stake_meta.rent_exempt_reserve + MIN_STAKE_LAMPORTS
}
