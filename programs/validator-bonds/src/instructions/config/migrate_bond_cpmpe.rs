use crate::state::bond::{find_bond_address, Bond, BondWithRevenueShare};
use crate::state::config::Config;
use anchor_lang::prelude::*;

/// Migrate Bond account to cpmpe
#[derive(Accounts)]
pub struct MigrateBondCpmpe<'info> {
    /// config root account that will be configured
    #[account(
        constraint = config.admin_authority == admin_authority.key() || config.operator_authority == admin_authority.key(),
    )]
    config: Account<'info, Config>,

    /// CHECK: deserialization check in code
    #[account(mut)]
    bond: UncheckedAccount<'info>,

    #[account()]
    admin_authority: Signer<'info>,
}

impl<'info> MigrateBondCpmpe<'info> {
    pub fn process(&mut self) -> Result<()> {
        let new_bond_data: Vec<u8>;
        {
            let original_bond_account_data = self.bond.try_borrow_data()?;
            let mut original_bond_account_data_slice: &[u8] = &original_bond_account_data;
            msg!(
                "original_bond_account_data: {:?}",
                original_bond_account_data
            );
            let original_bond = BondWithRevenueShare::try_deserialize_unchecked(
                &mut original_bond_account_data_slice,
            )?;

            let (bond_address, bond_bump) =
                find_bond_address(&self.config.key(), &original_bond.vote_account);
            msg!(
                "bond_address: {:?}, before check - config: {}, vote account: {}, bump: {}",
                bond_address,
                self.config.key(),
                original_bond.vote_account,
                original_bond.bump
            );
            require_eq!(bond_address, self.bond.key());
            require_eq!(original_bond.config, self.config.key());
            require_eq!(original_bond.bump, bond_bump);

            let new_bond = Bond {
                config: original_bond.config,
                vote_account: original_bond.vote_account,
                authority: original_bond.authority,
                cpmpe: 0,
                bump: original_bond.bump,
                ..Bond::default()
            };
            // NOTE: try to vec does not add the discriminator stuff
            new_bond_data = new_bond.try_to_vec()?;

            msg!(
                "Migrating bond account to cpmpe from '{:?}' to '{:?}'",
                self.bond,
                new_bond
            );
        }

        let bond_account_info = self.bond.to_account_info();
        let mut bond_account_data = bond_account_info.try_borrow_mut_data()?;
        if new_bond_data.len() + 8 > bond_account_data.len() {
            msg!(
                "New bond data is larger than the old one, old : {}, new : {}",
                bond_account_data.len(),
                new_bond_data.len()
            );
            return Err(ErrorCode::InvalidProgramId.into());
        }
        msg!("new_bond_data: {:?}", new_bond_data);
        bond_account_data[8..new_bond_data.len() + 8].copy_from_slice(&new_bond_data[..]);

        Ok(())
    }
}
