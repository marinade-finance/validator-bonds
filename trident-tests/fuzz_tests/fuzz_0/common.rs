use crate::fuzz_instructions::validator_bonds_fuzz_instructions::FuzzAccounts;
use anchor_lang::solana_program::native_token::LAMPORTS_PER_SOL;
use trident_client::fuzzing::solana_sdk::account::{AccountSharedData, WritableAccount};
use trident_client::fuzzing::solana_sdk::clock::{Clock, Epoch};
use trident_client::fuzzing::solana_sdk::rent::Rent;
use trident_client::fuzzing::solana_sdk::stake::state::{
    Authorized, Delegation, Meta, Stake, StakeStateV2,
};
use trident_client::fuzzing::solana_sdk::stake::tools::get_minimum_delegation;
use trident_client::fuzzing::solana_sdk::vote::state::{VoteInit, VoteState, VoteStateVersions};
use trident_client::fuzzing::{AccountId, AccountsStorage, FuzzClient, Keypair, Pubkey, Signer};
use trident_client::prelude::solana_sdk::stake::stake_flags::StakeFlags;

pub fn get_or_create_vote_account(
    votea_accounts_storage: &mut AccountsStorage<Keypair>,
    account_id: AccountId,
    client: &mut impl FuzzClient,
    node_pubkey: Pubkey,
) -> Option<Pubkey> {
    let key = votea_accounts_storage
        .storage()
        .entry(account_id)
        .or_insert_with(|| set_vote_account_with_node_pubkey(client, node_pubkey));
    Some(key.pubkey())
}

pub fn set_vote_account_with_node_pubkey(
    client: &mut impl FuzzClient,
    node_pubkey: Pubkey,
) -> Keypair {
    let authorized_voter = Pubkey::new_unique();
    let authorized_withdrawer = Pubkey::new_unique();
    let commission = 0;
    set_vote_account(
        client,
        node_pubkey,
        authorized_voter,
        authorized_withdrawer,
        commission,
    )
}

pub fn set_vote_account(
    client: &mut impl FuzzClient,
    node_pubkey: Pubkey, // validator identity
    authorized_voter: Pubkey,
    authorized_withdrawer: Pubkey,
    commission: u8,
) -> Keypair {
    let vote_account_keypair = Keypair::new();

    let rent = Rent::default();
    let lamports = rent.minimum_balance(VoteState::size_of());
    let mut vote_account = AccountSharedData::new(
        lamports,
        VoteState::size_of(),
        &trident_client::fuzzing::solana_sdk::vote::program::ID,
    );

    let vote_state = VoteState::new(
        &VoteInit {
            node_pubkey: node_pubkey,
            authorized_voter: authorized_voter,
            authorized_withdrawer: authorized_withdrawer,
            commission,
        },
        &Clock::default(),
    );

    VoteState::serialize(
        &VoteStateVersions::Current(Box::new(vote_state)),
        vote_account.data_as_mut_slice(),
    )
    .unwrap();

    client.set_account_custom(&vote_account_keypair.pubkey(), &vote_account);

    vote_account_keypair
}

pub fn set_initialized_stake_account(client: &mut impl FuzzClient) -> Pubkey {
    let stake_account_key = Keypair::new().pubkey();

    let rent = Rent::default();
    let lamports = rent.minimum_balance(StakeStateV2::size_of());
    let stake_account = AccountSharedData::new_data_with_space(
        lamports,
        &StakeStateV2::Initialized(Meta {
            authorized: Authorized {
                staker: stake_account_key,
                withdrawer: stake_account_key,
            },
            ..Meta::default()
        }),
        StakeStateV2::size_of(),
        &trident_client::fuzzing::solana_sdk::stake::program::ID,
    )
    .unwrap();

    client.set_account_custom(&stake_account_key, &stake_account);

    stake_account_key
}

pub fn get_or_create_delegated_stake_account(
    stake_accounts_storage: &mut AccountsStorage<Keypair>,
    account_id: AccountId,
    client: &mut impl FuzzClient,
    vote_account: Pubkey,
    authority: Pubkey,
) -> Option<Pubkey> {
    let key = stake_accounts_storage
        .storage()
        .entry(account_id)
        .or_insert_with(|| {
            set_delegated_stake_accounts_with_defaults(client, vote_account, authority)
        });
    Some(key.pubkey())
}

pub fn set_delegated_stake_accounts_with_defaults(
    client: &mut impl FuzzClient,
    vote_account: Pubkey,
    authority: Pubkey,
) -> Keypair {
    let clock = Clock::default();
    set_delegated_stake_account(
        client,
        vote_account,
        authority,
        authority,
        100 * LAMPORTS_PER_SOL,
        clock.epoch,
        None,
    )
}

pub fn set_delegated_stake_account(
    client: &mut impl FuzzClient,
    voter_pubkey: Pubkey, // vote account delegated to
    staker: Pubkey,
    withdrawer: Pubkey,
    stake: u64,
    activation_epoch: Epoch,
    deactiavation_epoch: Option<Epoch>,
) -> Keypair {
    let stake_account_keypair = Keypair::new();

    let rent = Rent::default();
    let lamports = rent.minimum_balance(StakeStateV2::size_of());
    let minimum_delegation = LAMPORTS_PER_SOL; // TODO: maybe to load from solana
    let minimum_lamports = lamports + minimum_delegation;

    let stake_account = AccountSharedData::new_data_with_space(
        if stake > minimum_lamports {
            stake
        } else {
            minimum_lamports
        },
        &StakeStateV2::Stake(
            Meta {
                authorized: Authorized { staker, withdrawer },
                ..Meta::default()
            },
            Stake {
                delegation: Delegation {
                    stake,
                    activation_epoch,
                    voter_pubkey,
                    deactivation_epoch: if let Some(epoch) = deactiavation_epoch {
                        epoch
                    } else {
                        u64::MAX
                    },
                    ..Delegation::default()
                },
                ..Stake::default()
            },
            StakeFlags::default(),
        ),
        StakeStateV2::size_of(),
        &trident_client::fuzzing::solana_sdk::stake::program::ID,
    )
    .unwrap();

    client.set_account_custom(&stake_account_keypair.pubkey(), &stake_account);

    stake_account_keypair
}
