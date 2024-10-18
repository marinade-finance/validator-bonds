use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::metadata::Metadata;
use anchor_spl::stake::{Stake, StakeAccount};
use anchor_spl::token::{Mint, Token, TokenAccount};
use trident_client::fuzzing::{anchor_lang, FuzzingError};
use {Account, Program, Pubkey, Signer, Sysvar, UncheckedAccount};

pub struct InitConfigSnapshot<'info> {
    pub config: Option<Account<'info, validator_bonds::state::config::Config>>,
    pub rent_payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub event_authority: &'info AccountInfo<'info>,
    pub program: &'info AccountInfo<'info>,
}
pub struct ConfigureConfigSnapshot<'info> {
    pub config: Account<'info, validator_bonds::state::config::Config>,
    pub admin_authority: Signer<'info>,
    pub event_authority: &'info AccountInfo<'info>,
    pub program: &'info AccountInfo<'info>,
}
pub struct InitBondSnapshot<'info> {
    pub config: Account<'info, validator_bonds::state::config::Config>,
    pub vote_account: UncheckedAccount<'info>,
    pub validator_identity: Option<Signer<'info>>,
    pub bond: Option<Account<'info, validator_bonds::state::bond::Bond>>,
    pub rent_payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub event_authority: &'info AccountInfo<'info>,
    pub program: &'info AccountInfo<'info>,
}
pub struct ConfigureBondSnapshot<'info> {
    pub config: Account<'info, validator_bonds::state::config::Config>,
    pub bond: Account<'info, validator_bonds::state::bond::Bond>,
    pub authority: Signer<'info>,
    pub vote_account: UncheckedAccount<'info>,
    pub event_authority: &'info AccountInfo<'info>,
    pub program: &'info AccountInfo<'info>,
}
pub struct ConfigureBondWithMintSnapshot<'info> {
    pub config: Account<'info, validator_bonds::state::config::Config>,
    pub bond: Account<'info, validator_bonds::state::bond::Bond>,
    pub mint: Account<'info, Mint>,
    pub vote_account: UncheckedAccount<'info>,
    pub token_account: Account<'info, TokenAccount>,
    pub token_authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub event_authority: &'info AccountInfo<'info>,
    pub program: &'info AccountInfo<'info>,
}
pub struct MintBondSnapshot<'info> {
    pub config: Account<'info, validator_bonds::state::config::Config>,
    pub bond: Account<'info, validator_bonds::state::bond::Bond>,
    pub mint: Option<Account<'info, Mint>>,
    pub validator_identity: UncheckedAccount<'info>,
    pub validator_identity_token_account: Option<Account<'info, TokenAccount>>,
    pub vote_account: UncheckedAccount<'info>,
    pub metadata: UncheckedAccount<'info>,
    pub rent_payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub metadata_program: Program<'info, Metadata>,
    pub rent: Sysvar<'info, Rent>,
    pub event_authority: &'info AccountInfo<'info>,
    pub program: &'info AccountInfo<'info>,
}
pub struct FundBondSnapshot<'info> {
    pub config: Account<'info, validator_bonds::state::config::Config>,
    pub bond: Account<'info, validator_bonds::state::bond::Bond>,
    pub bonds_withdrawer_authority: UncheckedAccount<'info>,
    pub stake_account: Account<'info, StakeAccount>,
    pub stake_authority: Signer<'info>,
    pub clock: Sysvar<'info, Clock>,
    pub stake_history: Sysvar<'info, StakeHistory>,
    pub stake_program: Program<'info, Stake>,
    pub event_authority: &'info AccountInfo<'info>,
    pub program: &'info AccountInfo<'info>,
}
pub struct InitWithdrawRequestSnapshot<'info> {
    pub config: Account<'info, validator_bonds::state::config::Config>,
    pub bond: Account<'info, validator_bonds::state::bond::Bond>,
    pub vote_account: UncheckedAccount<'info>,
    pub authority: Signer<'info>,
    pub withdraw_request:
        Option<Account<'info, validator_bonds::state::withdraw_request::WithdrawRequest>>,
    pub rent_payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub event_authority: &'info AccountInfo<'info>,
    pub program: &'info AccountInfo<'info>,
}
pub struct CancelWithdrawRequestSnapshot<'info> {
    pub config: Account<'info, validator_bonds::state::config::Config>,
    pub bond: Account<'info, validator_bonds::state::bond::Bond>,
    pub vote_account: UncheckedAccount<'info>,
    pub authority: Signer<'info>,
    pub withdraw_request:
        Option<Account<'info, validator_bonds::state::withdraw_request::WithdrawRequest>>,
    pub rent_collector: UncheckedAccount<'info>,
    pub event_authority: &'info AccountInfo<'info>,
    pub program: &'info AccountInfo<'info>,
}
pub struct ClaimWithdrawRequestSnapshot<'info> {
    pub config: Account<'info, validator_bonds::state::config::Config>,
    pub bond: Account<'info, validator_bonds::state::bond::Bond>,
    pub vote_account: UncheckedAccount<'info>,
    pub authority: Signer<'info>,
    pub withdraw_request: Account<'info, validator_bonds::state::withdraw_request::WithdrawRequest>,
    pub bonds_withdrawer_authority: UncheckedAccount<'info>,
    pub stake_account: Account<'info, StakeAccount>,
    pub withdrawer: UncheckedAccount<'info>,
    pub split_stake_account: Option<Account<'info, StakeAccount>>,
    pub split_stake_rent_payer: Signer<'info>,
    pub stake_program: Program<'info, Stake>,
    pub system_program: Program<'info, System>,
    pub stake_history: Sysvar<'info, StakeHistory>,
    pub clock: Sysvar<'info, Clock>,
    pub event_authority: &'info AccountInfo<'info>,
    pub program: &'info AccountInfo<'info>,
}
pub struct InitSettlementSnapshot<'info> {
    pub config: Account<'info, validator_bonds::state::config::Config>,
    pub bond: Account<'info, validator_bonds::state::bond::Bond>,
    pub settlement: Option<Account<'info, validator_bonds::state::settlement::Settlement>>,
    pub settlement_claims:
        Option<Account<'info, validator_bonds::state::settlement_claims::SettlementClaims>>,
    pub operator_authority: Signer<'info>,
    pub rent_payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub event_authority: &'info AccountInfo<'info>,
    pub program: &'info AccountInfo<'info>,
}
pub struct UpsizeSettlementClaimsSnapshot<'info> {
    pub settlement_claims:
        Account<'info, validator_bonds::state::settlement_claims::SettlementClaims>,
    pub rent_payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
pub struct CancelSettlementSnapshot<'info> {
    pub config: Account<'info, validator_bonds::state::config::Config>,
    pub bond: Account<'info, validator_bonds::state::bond::Bond>,
    pub settlement: Option<Account<'info, validator_bonds::state::settlement::Settlement>>,
    pub settlement_claims:
        Option<Account<'info, validator_bonds::state::settlement_claims::SettlementClaims>>,
    pub authority: Signer<'info>,
    pub bonds_withdrawer_authority: UncheckedAccount<'info>,
    pub rent_collector: UncheckedAccount<'info>,
    pub split_rent_collector: UncheckedAccount<'info>,
    pub split_rent_refund_account: UncheckedAccount<'info>,
    pub clock: Sysvar<'info, Clock>,
    pub stake_program: Program<'info, Stake>,
    pub stake_history: UncheckedAccount<'info>,
    pub event_authority: &'info AccountInfo<'info>,
    pub program: &'info AccountInfo<'info>,
}
pub struct FundSettlementSnapshot<'info> {
    pub config: Account<'info, validator_bonds::state::config::Config>,
    pub bond: Account<'info, validator_bonds::state::bond::Bond>,
    pub vote_account: UncheckedAccount<'info>,
    pub settlement: Account<'info, validator_bonds::state::settlement::Settlement>,
    pub operator_authority: Signer<'info>,
    pub stake_account: Account<'info, StakeAccount>,
    pub settlement_staker_authority: UncheckedAccount<'info>,
    pub bonds_withdrawer_authority: UncheckedAccount<'info>,
    pub split_stake_account: Option<Account<'info, StakeAccount>>,
    pub split_stake_rent_payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub stake_history: UncheckedAccount<'info>,
    pub clock: Sysvar<'info, Clock>,
    pub rent: Sysvar<'info, Rent>,
    pub stake_program: Program<'info, Stake>,
    pub stake_config: UncheckedAccount<'info>,
    pub event_authority: &'info AccountInfo<'info>,
    pub program: &'info AccountInfo<'info>,
}
pub struct MergeStakeSnapshot<'info> {
    pub config: Account<'info, validator_bonds::state::config::Config>,
    pub source_stake: Account<'info, StakeAccount>,
    pub destination_stake: Account<'info, StakeAccount>,
    pub staker_authority: UncheckedAccount<'info>,
    pub stake_history: UncheckedAccount<'info>,
    pub clock: Sysvar<'info, Clock>,
    pub stake_program: Program<'info, Stake>,
    pub event_authority: &'info AccountInfo<'info>,
    pub program: &'info AccountInfo<'info>,
}
pub struct ResetStakeSnapshot<'info> {
    pub config: Account<'info, validator_bonds::state::config::Config>,
    pub bond: Account<'info, validator_bonds::state::bond::Bond>,
    pub settlement: UncheckedAccount<'info>,
    pub stake_account: Account<'info, StakeAccount>,
    pub bonds_withdrawer_authority: UncheckedAccount<'info>,
    pub vote_account: UncheckedAccount<'info>,
    pub stake_history: UncheckedAccount<'info>,
    pub stake_config: UncheckedAccount<'info>,
    pub clock: Sysvar<'info, Clock>,
    pub stake_program: Program<'info, Stake>,
    pub event_authority: &'info AccountInfo<'info>,
    pub program: &'info AccountInfo<'info>,
}
pub struct WithdrawStakeSnapshot<'info> {
    pub config: Account<'info, validator_bonds::state::config::Config>,
    pub operator_authority: Signer<'info>,
    pub settlement: UncheckedAccount<'info>,
    pub stake_account: Account<'info, StakeAccount>,
    pub bonds_withdrawer_authority: UncheckedAccount<'info>,
    pub withdraw_to: UncheckedAccount<'info>,
    pub stake_history: UncheckedAccount<'info>,
    pub clock: Sysvar<'info, Clock>,
    pub stake_program: Program<'info, Stake>,
    pub event_authority: &'info AccountInfo<'info>,
    pub program: &'info AccountInfo<'info>,
}
pub struct EmergencyPauseSnapshot<'info> {
    pub config: Account<'info, validator_bonds::state::config::Config>,
    pub pause_authority: Signer<'info>,
    pub event_authority: &'info AccountInfo<'info>,
    pub program: &'info AccountInfo<'info>,
}
pub struct CloseSettlementV2Snapshot<'info> {
    pub config: Account<'info, validator_bonds::state::config::Config>,
    pub bond: Account<'info, validator_bonds::state::bond::Bond>,
    pub settlement: Option<Account<'info, validator_bonds::state::settlement::Settlement>>,
    pub settlement_claims:
        Option<Account<'info, validator_bonds::state::settlement_claims::SettlementClaims>>,
    pub bonds_withdrawer_authority: UncheckedAccount<'info>,
    pub rent_collector: UncheckedAccount<'info>,
    pub split_rent_collector: UncheckedAccount<'info>,
    pub split_rent_refund_account: UncheckedAccount<'info>,
    pub clock: Sysvar<'info, Clock>,
    pub stake_program: Program<'info, Stake>,
    pub stake_history: UncheckedAccount<'info>,
    pub event_authority: &'info AccountInfo<'info>,
    pub program: &'info AccountInfo<'info>,
}
pub struct ClaimSettlementV2Snapshot<'info> {
    pub config: Account<'info, validator_bonds::state::config::Config>,
    pub bond: Account<'info, validator_bonds::state::bond::Bond>,
    pub settlement: Account<'info, validator_bonds::state::settlement::Settlement>,
    pub settlement_claims:
        Account<'info, validator_bonds::state::settlement_claims::SettlementClaims>,
    pub stake_account_from: Account<'info, StakeAccount>,
    pub stake_account_to: Account<'info, StakeAccount>,
    pub bonds_withdrawer_authority: UncheckedAccount<'info>,
    pub stake_history: UncheckedAccount<'info>,
    pub clock: Sysvar<'info, Clock>,
    pub stake_program: Program<'info, Stake>,
    pub event_authority: &'info AccountInfo<'info>,
    pub program: &'info AccountInfo<'info>,
}
impl<'info> InitConfigSnapshot<'info> {
    pub fn deserialize_option(
        _program_id: &Pubkey,
        accounts: &'info mut [Option<AccountInfo<'info>>],
    ) -> core::result::Result<Self, FuzzingError> {
        let mut accounts_iter = accounts.iter();
        let config: Option<Account<validator_bonds::state::config::Config>> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("config".to_string()))?
            .as_ref()
            .map(|acc| {
                if acc.key() != *_program_id {
                    Account::try_from(acc)
                        .map_err(|_| FuzzingError::CannotDeserializeAccount("config".to_string()))
                } else {
                    Err(FuzzingError::OptionalAccountNotProvided(
                        "config".to_string(),
                    ))
                }
            })
            .transpose()
            .unwrap_or(None);
        let rent_payer: Signer<'_> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("rent_payer".to_string()))?
            .as_ref()
            .map(Signer::try_from)
            .ok_or(FuzzingError::AccountNotFound("rent_payer".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("rent_payer".to_string()))?;
        let system_program: Program<System> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "system_program".to_string(),
            ))?
            .as_ref()
            .map(Program::try_from)
            .ok_or(FuzzingError::AccountNotFound("system_program".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("system_program".to_string()))?;
        let event_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "event_authority".to_string(),
            ))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("event_authority".to_string()))?;
        let program = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("program".to_string()))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("program".to_string()))?;
        Ok(Self {
            config,
            rent_payer,
            system_program,
            event_authority,
            program,
        })
    }
}
impl<'info> ConfigureConfigSnapshot<'info> {
    pub fn deserialize_option(
        _program_id: &Pubkey,
        accounts: &'info mut [Option<AccountInfo<'info>>],
    ) -> core::result::Result<Self, FuzzingError> {
        let mut accounts_iter = accounts.iter();
        let config: Account<validator_bonds::state::config::Config> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("config".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("config".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("config".to_string()))?;
        let admin_authority: Signer<'_> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "admin_authority".to_string(),
            ))?
            .as_ref()
            .map(Signer::try_from)
            .ok_or(FuzzingError::AccountNotFound("admin_authority".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("admin_authority".to_string()))?;
        let event_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "event_authority".to_string(),
            ))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("event_authority".to_string()))?;
        let program = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("program".to_string()))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("program".to_string()))?;
        Ok(Self {
            config,
            admin_authority,
            event_authority,
            program,
        })
    }
}
impl<'info> InitBondSnapshot<'info> {
    pub fn deserialize_option(
        _program_id: &Pubkey,
        accounts: &'info mut [Option<AccountInfo<'info>>],
    ) -> core::result::Result<Self, FuzzingError> {
        let mut accounts_iter = accounts.iter();
        let config: Account<validator_bonds::state::config::Config> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("config".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("config".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("config".to_string()))?;
        let vote_account = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("vote_account".to_string()))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound("vote_account".to_string()))?;
        let validator_identity: Option<Signer<'_>> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "validator_identity".to_string(),
            ))?
            .as_ref()
            .map(|acc| {
                if acc.key() != *_program_id {
                    Signer::try_from(acc).map_err(|_| {
                        FuzzingError::CannotDeserializeAccount("validator_identity".to_string())
                    })
                } else {
                    Err(FuzzingError::OptionalAccountNotProvided(
                        "validator_identity".to_string(),
                    ))
                }
            })
            .transpose()
            .unwrap_or(None);
        let bond: Option<Account<validator_bonds::state::bond::Bond>> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("bond".to_string()))?
            .as_ref()
            .map(|acc| {
                if acc.key() != *_program_id {
                    Account::try_from(acc)
                        .map_err(|_| FuzzingError::CannotDeserializeAccount("bond".to_string()))
                } else {
                    Err(FuzzingError::OptionalAccountNotProvided("bond".to_string()))
                }
            })
            .transpose()
            .unwrap_or(None);
        let rent_payer: Signer<'_> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("rent_payer".to_string()))?
            .as_ref()
            .map(Signer::try_from)
            .ok_or(FuzzingError::AccountNotFound("rent_payer".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("rent_payer".to_string()))?;
        let system_program: Program<System> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "system_program".to_string(),
            ))?
            .as_ref()
            .map(Program::try_from)
            .ok_or(FuzzingError::AccountNotFound("system_program".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("system_program".to_string()))?;
        let event_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "event_authority".to_string(),
            ))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("event_authority".to_string()))?;
        let program = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("program".to_string()))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("program".to_string()))?;
        Ok(Self {
            config,
            vote_account,
            validator_identity,
            bond,
            rent_payer,
            system_program,
            event_authority,
            program,
        })
    }
}
impl<'info> ConfigureBondSnapshot<'info> {
    pub fn deserialize_option(
        _program_id: &Pubkey,
        accounts: &'info mut [Option<AccountInfo<'info>>],
    ) -> core::result::Result<Self, FuzzingError> {
        let mut accounts_iter = accounts.iter();
        let config: Account<validator_bonds::state::config::Config> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("config".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("config".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("config".to_string()))?;
        let bond: Account<validator_bonds::state::bond::Bond> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("bond".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("bond".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("bond".to_string()))?;
        let authority: Signer<'_> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("authority".to_string()))?
            .as_ref()
            .map(Signer::try_from)
            .ok_or(FuzzingError::AccountNotFound("authority".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("authority".to_string()))?;
        let vote_account = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("vote_account".to_string()))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound("vote_account".to_string()))?;
        let event_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "event_authority".to_string(),
            ))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("event_authority".to_string()))?;
        let program = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("program".to_string()))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("program".to_string()))?;
        Ok(Self {
            config,
            bond,
            authority,
            vote_account,
            event_authority,
            program,
        })
    }
}
impl<'info> ConfigureBondWithMintSnapshot<'info> {
    pub fn deserialize_option(
        _program_id: &Pubkey,
        accounts: &'info mut [Option<AccountInfo<'info>>],
    ) -> core::result::Result<Self, FuzzingError> {
        let mut accounts_iter = accounts.iter();
        let config: Account<validator_bonds::state::config::Config> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("config".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("config".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("config".to_string()))?;
        let bond: Account<validator_bonds::state::bond::Bond> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("bond".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("bond".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("bond".to_string()))?;
        let mint: Account<Mint> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("mint".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("mint".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("mint".to_string()))?;
        let vote_account = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("vote_account".to_string()))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound("vote_account".to_string()))?;
        let token_account: Account<TokenAccount> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("token_account".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("token_account".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("token_account".to_string()))?;
        let token_authority: Signer<'_> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "token_authority".to_string(),
            ))?
            .as_ref()
            .map(Signer::try_from)
            .ok_or(FuzzingError::AccountNotFound("token_authority".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("token_authority".to_string()))?;
        let token_program: Program<Token> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("token_program".to_string()))?
            .as_ref()
            .map(Program::try_from)
            .ok_or(FuzzingError::AccountNotFound("token_program".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("token_program".to_string()))?;
        let event_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "event_authority".to_string(),
            ))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("event_authority".to_string()))?;
        let program = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("program".to_string()))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("program".to_string()))?;
        Ok(Self {
            config,
            bond,
            mint,
            vote_account,
            token_account,
            token_authority,
            token_program,
            event_authority,
            program,
        })
    }
}
impl<'info> MintBondSnapshot<'info> {
    pub fn deserialize_option(
        _program_id: &Pubkey,
        accounts: &'info mut [Option<AccountInfo<'info>>],
    ) -> core::result::Result<Self, FuzzingError> {
        let mut accounts_iter = accounts.iter();
        let config: Account<validator_bonds::state::config::Config> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("config".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("config".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("config".to_string()))?;
        let bond: Account<validator_bonds::state::bond::Bond> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("bond".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("bond".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("bond".to_string()))?;
        let mint: Option<Account<Mint>> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("mint".to_string()))?
            .as_ref()
            .map(|acc| {
                if acc.key() != *_program_id {
                    Account::try_from(acc)
                        .map_err(|_| FuzzingError::CannotDeserializeAccount("mint".to_string()))
                } else {
                    Err(FuzzingError::OptionalAccountNotProvided("mint".to_string()))
                }
            })
            .transpose()
            .unwrap_or(None);
        let validator_identity = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "validator_identity".to_string(),
            ))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound(
                "validator_identity".to_string(),
            ))?;
        let validator_identity_token_account: Option<Account<TokenAccount>> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "validator_identity_token_account".to_string(),
            ))?
            .as_ref()
            .map(|acc| {
                if acc.key() != *_program_id {
                    Account::try_from(acc).map_err(|_| {
                        FuzzingError::CannotDeserializeAccount(
                            "validator_identity_token_account".to_string(),
                        )
                    })
                } else {
                    Err(FuzzingError::OptionalAccountNotProvided(
                        "validator_identity_token_account".to_string(),
                    ))
                }
            })
            .transpose()
            .unwrap_or(None);
        let vote_account = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("vote_account".to_string()))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound("vote_account".to_string()))?;
        let metadata = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("metadata".to_string()))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound("metadata".to_string()))?;
        let rent_payer: Signer<'_> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("rent_payer".to_string()))?
            .as_ref()
            .map(Signer::try_from)
            .ok_or(FuzzingError::AccountNotFound("rent_payer".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("rent_payer".to_string()))?;
        let system_program: Program<System> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "system_program".to_string(),
            ))?
            .as_ref()
            .map(Program::try_from)
            .ok_or(FuzzingError::AccountNotFound("system_program".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("system_program".to_string()))?;
        let token_program: Program<Token> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("token_program".to_string()))?
            .as_ref()
            .map(Program::try_from)
            .ok_or(FuzzingError::AccountNotFound("token_program".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("token_program".to_string()))?;
        let associated_token_program: Program<AssociatedToken> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "associated_token_program".to_string(),
            ))?
            .as_ref()
            .map(Program::try_from)
            .ok_or(FuzzingError::AccountNotFound(
                "associated_token_program".to_string(),
            ))?
            .map_err(|_| {
                FuzzingError::CannotDeserializeAccount("associated_token_program".to_string())
            })?;
        let metadata_program: Program<Metadata> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "metadata_program".to_string(),
            ))?
            .as_ref()
            .map(Program::try_from)
            .ok_or(FuzzingError::AccountNotFound(
                "metadata_program".to_string(),
            ))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("metadata_program".to_string()))?;
        let rent: Sysvar<Rent> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("rent".to_string()))?
            .as_ref()
            .map(Sysvar::from_account_info)
            .ok_or(FuzzingError::AccountNotFound("rent".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("rent".to_string()))?;
        let event_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "event_authority".to_string(),
            ))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("event_authority".to_string()))?;
        let program = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("program".to_string()))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("program".to_string()))?;
        Ok(Self {
            config,
            bond,
            mint,
            validator_identity,
            validator_identity_token_account,
            vote_account,
            metadata,
            rent_payer,
            system_program,
            token_program,
            associated_token_program,
            metadata_program,
            rent,
            event_authority,
            program,
        })
    }
}
impl<'info> FundBondSnapshot<'info> {
    pub fn deserialize_option(
        _program_id: &Pubkey,
        accounts: &'info mut [Option<AccountInfo<'info>>],
    ) -> core::result::Result<Self, FuzzingError> {
        let mut accounts_iter = accounts.iter();
        let config: Account<validator_bonds::state::config::Config> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("config".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("config".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("config".to_string()))?;
        let bond: Account<validator_bonds::state::bond::Bond> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("bond".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("bond".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("bond".to_string()))?;
        let bonds_withdrawer_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "bonds_withdrawer_authority".to_string(),
            ))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound(
                "bonds_withdrawer_authority".to_string(),
            ))?;
        let stake_account: Account<StakeAccount> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("stake_account".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("stake_account".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("stake_account".to_string()))?;
        let stake_authority: Signer<'_> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "stake_authority".to_string(),
            ))?
            .as_ref()
            .map(Signer::try_from)
            .ok_or(FuzzingError::AccountNotFound("stake_authority".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("stake_authority".to_string()))?;
        let clock: Sysvar<Clock> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("clock".to_string()))?
            .as_ref()
            .map(Sysvar::from_account_info)
            .ok_or(FuzzingError::AccountNotFound("clock".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("clock".to_string()))?;
        let stake_history: Sysvar<StakeHistory> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("stake_history".to_string()))?
            .as_ref()
            .map(Sysvar::from_account_info)
            .ok_or(FuzzingError::AccountNotFound("stake_history".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("stake_history".to_string()))?;
        let stake_program: Program<Stake> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("stake_program".to_string()))?
            .as_ref()
            .map(Program::try_from)
            .ok_or(FuzzingError::AccountNotFound("stake_program".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("stake_program".to_string()))?;
        let event_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "event_authority".to_string(),
            ))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("event_authority".to_string()))?;
        let program = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("program".to_string()))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("program".to_string()))?;
        Ok(Self {
            config,
            bond,
            bonds_withdrawer_authority,
            stake_account,
            stake_authority,
            clock,
            stake_history,
            stake_program,
            event_authority,
            program,
        })
    }
}
impl<'info> InitWithdrawRequestSnapshot<'info> {
    pub fn deserialize_option(
        _program_id: &Pubkey,
        accounts: &'info mut [Option<AccountInfo<'info>>],
    ) -> core::result::Result<Self, FuzzingError> {
        let mut accounts_iter = accounts.iter();
        let config: Account<validator_bonds::state::config::Config> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("config".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("config".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("config".to_string()))?;
        let bond: Account<validator_bonds::state::bond::Bond> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("bond".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("bond".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("bond".to_string()))?;
        let vote_account = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("vote_account".to_string()))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound("vote_account".to_string()))?;
        let authority: Signer<'_> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("authority".to_string()))?
            .as_ref()
            .map(Signer::try_from)
            .ok_or(FuzzingError::AccountNotFound("authority".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("authority".to_string()))?;
        let withdraw_request: Option<
            Account<validator_bonds::state::withdraw_request::WithdrawRequest>,
        > = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "withdraw_request".to_string(),
            ))?
            .as_ref()
            .map(|acc| {
                if acc.key() != *_program_id {
                    Account::try_from(acc).map_err(|_| {
                        FuzzingError::CannotDeserializeAccount("withdraw_request".to_string())
                    })
                } else {
                    Err(FuzzingError::OptionalAccountNotProvided(
                        "withdraw_request".to_string(),
                    ))
                }
            })
            .transpose()
            .unwrap_or(None);
        let rent_payer: Signer<'_> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("rent_payer".to_string()))?
            .as_ref()
            .map(Signer::try_from)
            .ok_or(FuzzingError::AccountNotFound("rent_payer".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("rent_payer".to_string()))?;
        let system_program: Program<System> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "system_program".to_string(),
            ))?
            .as_ref()
            .map(Program::try_from)
            .ok_or(FuzzingError::AccountNotFound("system_program".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("system_program".to_string()))?;
        let event_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "event_authority".to_string(),
            ))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("event_authority".to_string()))?;
        let program = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("program".to_string()))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("program".to_string()))?;
        Ok(Self {
            config,
            bond,
            vote_account,
            authority,
            withdraw_request,
            rent_payer,
            system_program,
            event_authority,
            program,
        })
    }
}
impl<'info> CancelWithdrawRequestSnapshot<'info> {
    pub fn deserialize_option(
        _program_id: &Pubkey,
        accounts: &'info mut [Option<AccountInfo<'info>>],
    ) -> core::result::Result<Self, FuzzingError> {
        let mut accounts_iter = accounts.iter();
        let config: Account<validator_bonds::state::config::Config> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("config".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("config".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("config".to_string()))?;
        let bond: Account<validator_bonds::state::bond::Bond> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("bond".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("bond".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("bond".to_string()))?;
        let vote_account = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("vote_account".to_string()))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound("vote_account".to_string()))?;
        let authority: Signer<'_> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("authority".to_string()))?
            .as_ref()
            .map(Signer::try_from)
            .ok_or(FuzzingError::AccountNotFound("authority".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("authority".to_string()))?;
        let withdraw_request: Option<
            Account<validator_bonds::state::withdraw_request::WithdrawRequest>,
        > = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "withdraw_request".to_string(),
            ))?
            .as_ref()
            .map(|acc| {
                if acc.key() != *_program_id {
                    Account::try_from(acc).map_err(|_| {
                        FuzzingError::CannotDeserializeAccount("withdraw_request".to_string())
                    })
                } else {
                    Err(FuzzingError::OptionalAccountNotProvided(
                        "withdraw_request".to_string(),
                    ))
                }
            })
            .transpose()
            .unwrap_or(None);
        let rent_collector = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "rent_collector".to_string(),
            ))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound("rent_collector".to_string()))?;
        let event_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "event_authority".to_string(),
            ))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("event_authority".to_string()))?;
        let program = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("program".to_string()))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("program".to_string()))?;
        Ok(Self {
            config,
            bond,
            vote_account,
            authority,
            withdraw_request,
            rent_collector,
            event_authority,
            program,
        })
    }
}
impl<'info> ClaimWithdrawRequestSnapshot<'info> {
    pub fn deserialize_option(
        _program_id: &Pubkey,
        accounts: &'info mut [Option<AccountInfo<'info>>],
    ) -> core::result::Result<Self, FuzzingError> {
        let mut accounts_iter = accounts.iter();
        let config: Account<validator_bonds::state::config::Config> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("config".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("config".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("config".to_string()))?;
        let bond: Account<validator_bonds::state::bond::Bond> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("bond".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("bond".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("bond".to_string()))?;
        let vote_account = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("vote_account".to_string()))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound("vote_account".to_string()))?;
        let authority: Signer<'_> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("authority".to_string()))?
            .as_ref()
            .map(Signer::try_from)
            .ok_or(FuzzingError::AccountNotFound("authority".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("authority".to_string()))?;
        let withdraw_request: Account<validator_bonds::state::withdraw_request::WithdrawRequest> =
            accounts_iter
                .next()
                .ok_or(FuzzingError::NotEnoughAccounts(
                    "withdraw_request".to_string(),
                ))?
                .as_ref()
                .map(Account::try_from)
                .ok_or(FuzzingError::AccountNotFound(
                    "withdraw_request".to_string(),
                ))?
                .map_err(|_| {
                    FuzzingError::CannotDeserializeAccount("withdraw_request".to_string())
                })?;
        let bonds_withdrawer_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "bonds_withdrawer_authority".to_string(),
            ))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound(
                "bonds_withdrawer_authority".to_string(),
            ))?;
        let stake_account: Account<StakeAccount> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("stake_account".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("stake_account".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("stake_account".to_string()))?;
        let withdrawer = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("withdrawer".to_string()))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound("withdrawer".to_string()))?;
        let split_stake_account: Option<Account<StakeAccount>> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "split_stake_account".to_string(),
            ))?
            .as_ref()
            .map(|acc| {
                if acc.key() != *_program_id {
                    Account::try_from(acc).map_err(|_| {
                        FuzzingError::CannotDeserializeAccount("split_stake_account".to_string())
                    })
                } else {
                    Err(FuzzingError::OptionalAccountNotProvided(
                        "split_stake_account".to_string(),
                    ))
                }
            })
            .transpose()
            .unwrap_or(None);
        let split_stake_rent_payer: Signer<'_> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "split_stake_rent_payer".to_string(),
            ))?
            .as_ref()
            .map(Signer::try_from)
            .ok_or(FuzzingError::AccountNotFound(
                "split_stake_rent_payer".to_string(),
            ))?
            .map_err(|_| {
                FuzzingError::CannotDeserializeAccount("split_stake_rent_payer".to_string())
            })?;
        let stake_program: Program<Stake> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("stake_program".to_string()))?
            .as_ref()
            .map(Program::try_from)
            .ok_or(FuzzingError::AccountNotFound("stake_program".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("stake_program".to_string()))?;
        let system_program: Program<System> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "system_program".to_string(),
            ))?
            .as_ref()
            .map(Program::try_from)
            .ok_or(FuzzingError::AccountNotFound("system_program".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("system_program".to_string()))?;
        let stake_history: Sysvar<StakeHistory> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("stake_history".to_string()))?
            .as_ref()
            .map(Sysvar::from_account_info)
            .ok_or(FuzzingError::AccountNotFound("stake_history".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("stake_history".to_string()))?;
        let clock: Sysvar<Clock> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("clock".to_string()))?
            .as_ref()
            .map(Sysvar::from_account_info)
            .ok_or(FuzzingError::AccountNotFound("clock".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("clock".to_string()))?;
        let event_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "event_authority".to_string(),
            ))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("event_authority".to_string()))?;
        let program = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("program".to_string()))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("program".to_string()))?;
        Ok(Self {
            config,
            bond,
            vote_account,
            authority,
            withdraw_request,
            bonds_withdrawer_authority,
            stake_account,
            withdrawer,
            split_stake_account,
            split_stake_rent_payer,
            stake_program,
            system_program,
            stake_history,
            clock,
            event_authority,
            program,
        })
    }
}
impl<'info> InitSettlementSnapshot<'info> {
    pub fn deserialize_option(
        _program_id: &Pubkey,
        accounts: &'info mut [Option<AccountInfo<'info>>],
    ) -> core::result::Result<Self, FuzzingError> {
        let mut accounts_iter = accounts.iter();
        let config: Account<validator_bonds::state::config::Config> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("config".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("config".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("config".to_string()))?;
        let bond: Account<validator_bonds::state::bond::Bond> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("bond".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("bond".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("bond".to_string()))?;
        let settlement: Option<Account<validator_bonds::state::settlement::Settlement>> =
            accounts_iter
                .next()
                .ok_or(FuzzingError::NotEnoughAccounts("settlement".to_string()))?
                .as_ref()
                .map(|acc| {
                    if acc.key() != *_program_id {
                        Account::try_from(acc).map_err(|_| {
                            FuzzingError::CannotDeserializeAccount("settlement".to_string())
                        })
                    } else {
                        Err(FuzzingError::OptionalAccountNotProvided(
                            "settlement".to_string(),
                        ))
                    }
                })
                .transpose()
                .unwrap_or(None);
        let settlement_claims: Option<
            Account<validator_bonds::state::settlement_claims::SettlementClaims>,
        > = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "settlement_claims".to_string(),
            ))?
            .as_ref()
            .map(|acc| {
                if acc.key() != *_program_id {
                    Account::try_from(acc).map_err(|_| {
                        FuzzingError::CannotDeserializeAccount("settlement_claims".to_string())
                    })
                } else {
                    Err(FuzzingError::OptionalAccountNotProvided(
                        "settlement_claims".to_string(),
                    ))
                }
            })
            .transpose()
            .unwrap_or(None);
        let operator_authority: Signer<'_> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "operator_authority".to_string(),
            ))?
            .as_ref()
            .map(Signer::try_from)
            .ok_or(FuzzingError::AccountNotFound(
                "operator_authority".to_string(),
            ))?
            .map_err(|_| {
                FuzzingError::CannotDeserializeAccount("operator_authority".to_string())
            })?;
        let rent_payer: Signer<'_> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("rent_payer".to_string()))?
            .as_ref()
            .map(Signer::try_from)
            .ok_or(FuzzingError::AccountNotFound("rent_payer".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("rent_payer".to_string()))?;
        let system_program: Program<System> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "system_program".to_string(),
            ))?
            .as_ref()
            .map(Program::try_from)
            .ok_or(FuzzingError::AccountNotFound("system_program".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("system_program".to_string()))?;
        let event_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "event_authority".to_string(),
            ))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("event_authority".to_string()))?;
        let program = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("program".to_string()))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("program".to_string()))?;
        Ok(Self {
            config,
            bond,
            settlement,
            settlement_claims,
            operator_authority,
            rent_payer,
            system_program,
            event_authority,
            program,
        })
    }
}
impl<'info> UpsizeSettlementClaimsSnapshot<'info> {
    pub fn deserialize_option(
        _program_id: &Pubkey,
        accounts: &'info mut [Option<AccountInfo<'info>>],
    ) -> core::result::Result<Self, FuzzingError> {
        let mut accounts_iter = accounts.iter();
        let settlement_claims: Account<
            validator_bonds::state::settlement_claims::SettlementClaims,
        > = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "settlement_claims".to_string(),
            ))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound(
                "settlement_claims".to_string(),
            ))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("settlement_claims".to_string()))?;
        let rent_payer: Signer<'_> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("rent_payer".to_string()))?
            .as_ref()
            .map(Signer::try_from)
            .ok_or(FuzzingError::AccountNotFound("rent_payer".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("rent_payer".to_string()))?;
        let system_program: Program<System> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "system_program".to_string(),
            ))?
            .as_ref()
            .map(Program::try_from)
            .ok_or(FuzzingError::AccountNotFound("system_program".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("system_program".to_string()))?;
        Ok(Self {
            settlement_claims,
            rent_payer,
            system_program,
        })
    }
}
impl<'info> CancelSettlementSnapshot<'info> {
    pub fn deserialize_option(
        _program_id: &Pubkey,
        accounts: &'info mut [Option<AccountInfo<'info>>],
    ) -> core::result::Result<Self, FuzzingError> {
        let mut accounts_iter = accounts.iter();
        let config: Account<validator_bonds::state::config::Config> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("config".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("config".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("config".to_string()))?;
        let bond: Account<validator_bonds::state::bond::Bond> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("bond".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("bond".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("bond".to_string()))?;
        let settlement: Option<Account<validator_bonds::state::settlement::Settlement>> =
            accounts_iter
                .next()
                .ok_or(FuzzingError::NotEnoughAccounts("settlement".to_string()))?
                .as_ref()
                .map(|acc| {
                    if acc.key() != *_program_id {
                        Account::try_from(acc).map_err(|_| {
                            FuzzingError::CannotDeserializeAccount("settlement".to_string())
                        })
                    } else {
                        Err(FuzzingError::OptionalAccountNotProvided(
                            "settlement".to_string(),
                        ))
                    }
                })
                .transpose()
                .unwrap_or(None);
        let settlement_claims: Option<
            Account<validator_bonds::state::settlement_claims::SettlementClaims>,
        > = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "settlement_claims".to_string(),
            ))?
            .as_ref()
            .map(|acc| {
                if acc.key() != *_program_id {
                    Account::try_from(acc).map_err(|_| {
                        FuzzingError::CannotDeserializeAccount("settlement_claims".to_string())
                    })
                } else {
                    Err(FuzzingError::OptionalAccountNotProvided(
                        "settlement_claims".to_string(),
                    ))
                }
            })
            .transpose()
            .unwrap_or(None);
        let authority: Signer<'_> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("authority".to_string()))?
            .as_ref()
            .map(Signer::try_from)
            .ok_or(FuzzingError::AccountNotFound("authority".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("authority".to_string()))?;
        let bonds_withdrawer_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "bonds_withdrawer_authority".to_string(),
            ))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound(
                "bonds_withdrawer_authority".to_string(),
            ))?;
        let rent_collector = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "rent_collector".to_string(),
            ))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound("rent_collector".to_string()))?;
        let split_rent_collector = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "split_rent_collector".to_string(),
            ))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound(
                "split_rent_collector".to_string(),
            ))?;
        let split_rent_refund_account = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "split_rent_refund_account".to_string(),
            ))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound(
                "split_rent_refund_account".to_string(),
            ))?;
        let clock: Sysvar<Clock> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("clock".to_string()))?
            .as_ref()
            .map(Sysvar::from_account_info)
            .ok_or(FuzzingError::AccountNotFound("clock".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("clock".to_string()))?;
        let stake_program: Program<Stake> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("stake_program".to_string()))?
            .as_ref()
            .map(Program::try_from)
            .ok_or(FuzzingError::AccountNotFound("stake_program".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("stake_program".to_string()))?;
        let stake_history = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("stake_history".to_string()))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound("stake_history".to_string()))?;
        let event_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "event_authority".to_string(),
            ))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("event_authority".to_string()))?;
        let program = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("program".to_string()))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("program".to_string()))?;
        Ok(Self {
            config,
            bond,
            settlement,
            settlement_claims,
            authority,
            bonds_withdrawer_authority,
            rent_collector,
            split_rent_collector,
            split_rent_refund_account,
            clock,
            stake_program,
            stake_history,
            event_authority,
            program,
        })
    }
}
impl<'info> FundSettlementSnapshot<'info> {
    pub fn deserialize_option(
        _program_id: &Pubkey,
        accounts: &'info mut [Option<AccountInfo<'info>>],
    ) -> core::result::Result<Self, FuzzingError> {
        let mut accounts_iter = accounts.iter();
        let config: Account<validator_bonds::state::config::Config> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("config".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("config".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("config".to_string()))?;
        let bond: Account<validator_bonds::state::bond::Bond> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("bond".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("bond".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("bond".to_string()))?;
        let vote_account = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("vote_account".to_string()))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound("vote_account".to_string()))?;
        let settlement: Account<validator_bonds::state::settlement::Settlement> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("settlement".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("settlement".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("settlement".to_string()))?;
        let operator_authority: Signer<'_> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "operator_authority".to_string(),
            ))?
            .as_ref()
            .map(Signer::try_from)
            .ok_or(FuzzingError::AccountNotFound(
                "operator_authority".to_string(),
            ))?
            .map_err(|_| {
                FuzzingError::CannotDeserializeAccount("operator_authority".to_string())
            })?;
        let stake_account: Account<StakeAccount> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("stake_account".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("stake_account".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("stake_account".to_string()))?;
        let settlement_staker_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "settlement_staker_authority".to_string(),
            ))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound(
                "settlement_staker_authority".to_string(),
            ))?;
        let bonds_withdrawer_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "bonds_withdrawer_authority".to_string(),
            ))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound(
                "bonds_withdrawer_authority".to_string(),
            ))?;
        let split_stake_account: Option<Account<StakeAccount>> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "split_stake_account".to_string(),
            ))?
            .as_ref()
            .map(|acc| {
                if acc.key() != *_program_id {
                    Account::try_from(acc).map_err(|_| {
                        FuzzingError::CannotDeserializeAccount("split_stake_account".to_string())
                    })
                } else {
                    Err(FuzzingError::OptionalAccountNotProvided(
                        "split_stake_account".to_string(),
                    ))
                }
            })
            .transpose()
            .unwrap_or(None);
        let split_stake_rent_payer: Signer<'_> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "split_stake_rent_payer".to_string(),
            ))?
            .as_ref()
            .map(Signer::try_from)
            .ok_or(FuzzingError::AccountNotFound(
                "split_stake_rent_payer".to_string(),
            ))?
            .map_err(|_| {
                FuzzingError::CannotDeserializeAccount("split_stake_rent_payer".to_string())
            })?;
        let system_program: Program<System> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "system_program".to_string(),
            ))?
            .as_ref()
            .map(Program::try_from)
            .ok_or(FuzzingError::AccountNotFound("system_program".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("system_program".to_string()))?;
        let stake_history = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("stake_history".to_string()))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound("stake_history".to_string()))?;
        let clock: Sysvar<Clock> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("clock".to_string()))?
            .as_ref()
            .map(Sysvar::from_account_info)
            .ok_or(FuzzingError::AccountNotFound("clock".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("clock".to_string()))?;
        let rent: Sysvar<Rent> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("rent".to_string()))?
            .as_ref()
            .map(Sysvar::from_account_info)
            .ok_or(FuzzingError::AccountNotFound("rent".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("rent".to_string()))?;
        let stake_program: Program<Stake> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("stake_program".to_string()))?
            .as_ref()
            .map(Program::try_from)
            .ok_or(FuzzingError::AccountNotFound("stake_program".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("stake_program".to_string()))?;
        let stake_config = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("stake_config".to_string()))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound("stake_config".to_string()))?;
        let event_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "event_authority".to_string(),
            ))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("event_authority".to_string()))?;
        let program = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("program".to_string()))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("program".to_string()))?;
        Ok(Self {
            config,
            bond,
            vote_account,
            settlement,
            operator_authority,
            stake_account,
            settlement_staker_authority,
            bonds_withdrawer_authority,
            split_stake_account,
            split_stake_rent_payer,
            system_program,
            stake_history,
            clock,
            rent,
            stake_program,
            stake_config,
            event_authority,
            program,
        })
    }
}
impl<'info> MergeStakeSnapshot<'info> {
    pub fn deserialize_option(
        _program_id: &Pubkey,
        accounts: &'info mut [Option<AccountInfo<'info>>],
    ) -> core::result::Result<Self, FuzzingError> {
        let mut accounts_iter = accounts.iter();
        let config: Account<validator_bonds::state::config::Config> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("config".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("config".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("config".to_string()))?;
        let source_stake: Account<StakeAccount> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("source_stake".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("source_stake".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("source_stake".to_string()))?;
        let destination_stake: Account<StakeAccount> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "destination_stake".to_string(),
            ))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound(
                "destination_stake".to_string(),
            ))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("destination_stake".to_string()))?;
        let staker_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "staker_authority".to_string(),
            ))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound(
                "staker_authority".to_string(),
            ))?;
        let stake_history = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("stake_history".to_string()))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound("stake_history".to_string()))?;
        let clock: Sysvar<Clock> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("clock".to_string()))?
            .as_ref()
            .map(Sysvar::from_account_info)
            .ok_or(FuzzingError::AccountNotFound("clock".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("clock".to_string()))?;
        let stake_program: Program<Stake> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("stake_program".to_string()))?
            .as_ref()
            .map(Program::try_from)
            .ok_or(FuzzingError::AccountNotFound("stake_program".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("stake_program".to_string()))?;
        let event_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "event_authority".to_string(),
            ))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("event_authority".to_string()))?;
        let program = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("program".to_string()))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("program".to_string()))?;
        Ok(Self {
            config,
            source_stake,
            destination_stake,
            staker_authority,
            stake_history,
            clock,
            stake_program,
            event_authority,
            program,
        })
    }
}
impl<'info> ResetStakeSnapshot<'info> {
    pub fn deserialize_option(
        _program_id: &Pubkey,
        accounts: &'info mut [Option<AccountInfo<'info>>],
    ) -> core::result::Result<Self, FuzzingError> {
        let mut accounts_iter = accounts.iter();
        let config: Account<validator_bonds::state::config::Config> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("config".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("config".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("config".to_string()))?;
        let bond: Account<validator_bonds::state::bond::Bond> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("bond".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("bond".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("bond".to_string()))?;
        let settlement = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("settlement".to_string()))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound("settlement".to_string()))?;
        let stake_account: Account<StakeAccount> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("stake_account".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("stake_account".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("stake_account".to_string()))?;
        let bonds_withdrawer_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "bonds_withdrawer_authority".to_string(),
            ))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound(
                "bonds_withdrawer_authority".to_string(),
            ))?;
        let vote_account = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("vote_account".to_string()))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound("vote_account".to_string()))?;
        let stake_history = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("stake_history".to_string()))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound("stake_history".to_string()))?;
        let stake_config = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("stake_config".to_string()))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound("stake_config".to_string()))?;
        let clock: Sysvar<Clock> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("clock".to_string()))?
            .as_ref()
            .map(Sysvar::from_account_info)
            .ok_or(FuzzingError::AccountNotFound("clock".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("clock".to_string()))?;
        let stake_program: Program<Stake> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("stake_program".to_string()))?
            .as_ref()
            .map(Program::try_from)
            .ok_or(FuzzingError::AccountNotFound("stake_program".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("stake_program".to_string()))?;
        let event_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "event_authority".to_string(),
            ))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("event_authority".to_string()))?;
        let program = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("program".to_string()))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("program".to_string()))?;
        Ok(Self {
            config,
            bond,
            settlement,
            stake_account,
            bonds_withdrawer_authority,
            vote_account,
            stake_history,
            stake_config,
            clock,
            stake_program,
            event_authority,
            program,
        })
    }
}
impl<'info> WithdrawStakeSnapshot<'info> {
    pub fn deserialize_option(
        _program_id: &Pubkey,
        accounts: &'info mut [Option<AccountInfo<'info>>],
    ) -> core::result::Result<Self, FuzzingError> {
        let mut accounts_iter = accounts.iter();
        let config: Account<validator_bonds::state::config::Config> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("config".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("config".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("config".to_string()))?;
        let operator_authority: Signer<'_> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "operator_authority".to_string(),
            ))?
            .as_ref()
            .map(Signer::try_from)
            .ok_or(FuzzingError::AccountNotFound(
                "operator_authority".to_string(),
            ))?
            .map_err(|_| {
                FuzzingError::CannotDeserializeAccount("operator_authority".to_string())
            })?;
        let settlement = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("settlement".to_string()))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound("settlement".to_string()))?;
        let stake_account: Account<StakeAccount> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("stake_account".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("stake_account".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("stake_account".to_string()))?;
        let bonds_withdrawer_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "bonds_withdrawer_authority".to_string(),
            ))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound(
                "bonds_withdrawer_authority".to_string(),
            ))?;
        let withdraw_to = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("withdraw_to".to_string()))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound("withdraw_to".to_string()))?;
        let stake_history = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("stake_history".to_string()))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound("stake_history".to_string()))?;
        let clock: Sysvar<Clock> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("clock".to_string()))?
            .as_ref()
            .map(Sysvar::from_account_info)
            .ok_or(FuzzingError::AccountNotFound("clock".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("clock".to_string()))?;
        let stake_program: Program<Stake> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("stake_program".to_string()))?
            .as_ref()
            .map(Program::try_from)
            .ok_or(FuzzingError::AccountNotFound("stake_program".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("stake_program".to_string()))?;
        let event_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "event_authority".to_string(),
            ))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("event_authority".to_string()))?;
        let program = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("program".to_string()))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("program".to_string()))?;
        Ok(Self {
            config,
            operator_authority,
            settlement,
            stake_account,
            bonds_withdrawer_authority,
            withdraw_to,
            stake_history,
            clock,
            stake_program,
            event_authority,
            program,
        })
    }
}
impl<'info> EmergencyPauseSnapshot<'info> {
    pub fn deserialize_option(
        _program_id: &Pubkey,
        accounts: &'info mut [Option<AccountInfo<'info>>],
    ) -> core::result::Result<Self, FuzzingError> {
        let mut accounts_iter = accounts.iter();
        let config: Account<validator_bonds::state::config::Config> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("config".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("config".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("config".to_string()))?;
        let pause_authority: Signer<'_> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "pause_authority".to_string(),
            ))?
            .as_ref()
            .map(Signer::try_from)
            .ok_or(FuzzingError::AccountNotFound("pause_authority".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("pause_authority".to_string()))?;
        let event_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "event_authority".to_string(),
            ))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("event_authority".to_string()))?;
        let program = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("program".to_string()))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("program".to_string()))?;
        Ok(Self {
            config,
            pause_authority,
            event_authority,
            program,
        })
    }
}
impl<'info> CloseSettlementV2Snapshot<'info> {
    pub fn deserialize_option(
        _program_id: &Pubkey,
        accounts: &'info mut [Option<AccountInfo<'info>>],
    ) -> core::result::Result<Self, FuzzingError> {
        let mut accounts_iter = accounts.iter();
        let config: Account<validator_bonds::state::config::Config> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("config".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("config".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("config".to_string()))?;
        let bond: Account<validator_bonds::state::bond::Bond> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("bond".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("bond".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("bond".to_string()))?;
        let settlement: Option<Account<validator_bonds::state::settlement::Settlement>> =
            accounts_iter
                .next()
                .ok_or(FuzzingError::NotEnoughAccounts("settlement".to_string()))?
                .as_ref()
                .map(|acc| {
                    if acc.key() != *_program_id {
                        Account::try_from(acc).map_err(|_| {
                            FuzzingError::CannotDeserializeAccount("settlement".to_string())
                        })
                    } else {
                        Err(FuzzingError::OptionalAccountNotProvided(
                            "settlement".to_string(),
                        ))
                    }
                })
                .transpose()
                .unwrap_or(None);
        let settlement_claims: Option<
            Account<validator_bonds::state::settlement_claims::SettlementClaims>,
        > = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "settlement_claims".to_string(),
            ))?
            .as_ref()
            .map(|acc| {
                if acc.key() != *_program_id {
                    Account::try_from(acc).map_err(|_| {
                        FuzzingError::CannotDeserializeAccount("settlement_claims".to_string())
                    })
                } else {
                    Err(FuzzingError::OptionalAccountNotProvided(
                        "settlement_claims".to_string(),
                    ))
                }
            })
            .transpose()
            .unwrap_or(None);
        let bonds_withdrawer_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "bonds_withdrawer_authority".to_string(),
            ))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound(
                "bonds_withdrawer_authority".to_string(),
            ))?;
        let rent_collector = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "rent_collector".to_string(),
            ))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound("rent_collector".to_string()))?;
        let split_rent_collector = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "split_rent_collector".to_string(),
            ))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound(
                "split_rent_collector".to_string(),
            ))?;
        let split_rent_refund_account = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "split_rent_refund_account".to_string(),
            ))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound(
                "split_rent_refund_account".to_string(),
            ))?;
        let clock: Sysvar<Clock> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("clock".to_string()))?
            .as_ref()
            .map(Sysvar::from_account_info)
            .ok_or(FuzzingError::AccountNotFound("clock".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("clock".to_string()))?;
        let stake_program: Program<Stake> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("stake_program".to_string()))?
            .as_ref()
            .map(Program::try_from)
            .ok_or(FuzzingError::AccountNotFound("stake_program".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("stake_program".to_string()))?;
        let stake_history = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("stake_history".to_string()))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound("stake_history".to_string()))?;
        let event_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "event_authority".to_string(),
            ))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("event_authority".to_string()))?;
        let program = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("program".to_string()))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("program".to_string()))?;
        Ok(Self {
            config,
            bond,
            settlement,
            settlement_claims,
            bonds_withdrawer_authority,
            rent_collector,
            split_rent_collector,
            split_rent_refund_account,
            clock,
            stake_program,
            stake_history,
            event_authority,
            program,
        })
    }
}
impl<'info> ClaimSettlementV2Snapshot<'info> {
    pub fn deserialize_option(
        _program_id: &Pubkey,
        accounts: &'info mut [Option<AccountInfo<'info>>],
    ) -> core::result::Result<Self, FuzzingError> {
        let mut accounts_iter = accounts.iter();
        let config: Account<validator_bonds::state::config::Config> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("config".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("config".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("config".to_string()))?;
        let bond: Account<validator_bonds::state::bond::Bond> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("bond".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("bond".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("bond".to_string()))?;
        let settlement: Account<validator_bonds::state::settlement::Settlement> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("settlement".to_string()))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound("settlement".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("settlement".to_string()))?;
        let settlement_claims: Account<
            validator_bonds::state::settlement_claims::SettlementClaims,
        > = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "settlement_claims".to_string(),
            ))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound(
                "settlement_claims".to_string(),
            ))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("settlement_claims".to_string()))?;
        let stake_account_from: Account<StakeAccount> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "stake_account_from".to_string(),
            ))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound(
                "stake_account_from".to_string(),
            ))?
            .map_err(|_| {
                FuzzingError::CannotDeserializeAccount("stake_account_from".to_string())
            })?;
        let stake_account_to: Account<StakeAccount> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "stake_account_to".to_string(),
            ))?
            .as_ref()
            .map(Account::try_from)
            .ok_or(FuzzingError::AccountNotFound(
                "stake_account_to".to_string(),
            ))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("stake_account_to".to_string()))?;
        let bonds_withdrawer_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "bonds_withdrawer_authority".to_string(),
            ))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound(
                "bonds_withdrawer_authority".to_string(),
            ))?;
        let stake_history = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("stake_history".to_string()))?
            .as_ref()
            .map(UncheckedAccount::try_from)
            .ok_or(FuzzingError::AccountNotFound("stake_history".to_string()))?;
        let clock: Sysvar<Clock> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("clock".to_string()))?
            .as_ref()
            .map(Sysvar::from_account_info)
            .ok_or(FuzzingError::AccountNotFound("clock".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("clock".to_string()))?;
        let stake_program: Program<Stake> = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("stake_program".to_string()))?
            .as_ref()
            .map(Program::try_from)
            .ok_or(FuzzingError::AccountNotFound("stake_program".to_string()))?
            .map_err(|_| FuzzingError::CannotDeserializeAccount("stake_program".to_string()))?;
        let event_authority = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts(
                "event_authority".to_string(),
            ))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("event_authority".to_string()))?;
        let program = accounts_iter
            .next()
            .ok_or(FuzzingError::NotEnoughAccounts("program".to_string()))?
            .as_ref()
            .ok_or(FuzzingError::AccountNotFound("program".to_string()))?;
        Ok(Self {
            config,
            bond,
            settlement,
            settlement_claims,
            stake_account_from,
            stake_account_to,
            bonds_withdrawer_authority,
            stake_history,
            clock,
            stake_program,
            event_authority,
            program,
        })
    }
}
pub type EmergencyResumeSnapshot<'info> = EmergencyPauseSnapshot<'info>;
