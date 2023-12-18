use crate::checks::check_bond_change_permitted;
use crate::error::ErrorCode;
use crate::events::{bond::ConfigureBondEvent, HundrethBasisPointChange, PubkeyValueChange};
use crate::state::bond::Bond;
use crate::utils::basis_points::HundredthBasisPoint;
use anchor_lang::prelude::*;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct ConfigureBondArgs {
    pub bond_authority: Option<Pubkey>,
    pub revenue_share: Option<HundredthBasisPoint>,
}

/// Change parameters of validator bond account
#[derive(Accounts)]
pub struct ConfigureBond<'info> {
    #[account(
        mut,
        has_one = validator_vote_account @ ErrorCode::VoteAccountMismatch,
        seeds = [
            b"bond_account",
            bond.config.as_ref(),
            validator_vote_account.key().as_ref(),
        ],
        bump = bond.bump,
    )]
    bond: Account<'info, Bond>,

    /// validator vote account owner or bond authority may change the account
    #[account()]
    authority: Signer<'info>,

    /// CHECK: check&deserialize the vote account in the code
    #[account()]
    validator_vote_account: UncheckedAccount<'info>,
}

impl<'info> ConfigureBond<'info> {
    pub fn process(
        &mut self,
        ConfigureBondArgs {
            bond_authority,
            revenue_share,
        }: ConfigureBondArgs,
    ) -> Result<()> {
        require!(
            check_bond_change_permitted(
                &self.authority.key(),
                &self.bond,
                &self.validator_vote_account
            ),
            ErrorCode::BondChangeNotPermitted
        );

        let bond_authority_change = bond_authority.map(|authority| {
            let old = self.bond.authority;
            self.bond.authority = authority;
            PubkeyValueChange {
                old,
                new: authority,
            }
        });
        let revenue_share_change = match revenue_share {
            Some(revenue) => {
                let old = self.bond.revenue_share;
                self.bond.revenue_share = revenue.check()?;
                Some(HundrethBasisPointChange { old, new: revenue })
            }
            None => None,
        };

        emit!(ConfigureBondEvent {
            bond_authority: bond_authority_change,
            revenue_share: revenue_share_change,
        });

        Ok(())
    }
}
