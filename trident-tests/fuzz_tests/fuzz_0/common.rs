use anchor_lang::solana_program::native_token::LAMPORTS_PER_SOL;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_lang::{AccountSerialize, AnchorSerialize};
use anchor_spl::token::spl_token::state::Mint;
use std::collections::HashMap;
use trident_client::___private::TempClone;
use trident_client::fuzzing::solana_sdk::account::{AccountSharedData, WritableAccount};
use trident_client::fuzzing::solana_sdk::clock::{Clock, Epoch};
use trident_client::fuzzing::solana_sdk::program_option::COption;
use trident_client::fuzzing::solana_sdk::rent::Rent;
use trident_client::fuzzing::solana_sdk::stake::state::{
    Authorized, Delegation, Meta, Stake, StakeStateV2,
};
use trident_client::fuzzing::solana_sdk::vote::state::{VoteInit, VoteState, VoteStateVersions};
use trident_client::fuzzing::{
    AccountId, AccountsStorage, FuzzClient, Keypair, PdaStore, Pubkey, Signer,
};
use trident_client::prelude::solana_sdk::stake::stake_flags::StakeFlags;
use validator_bonds::state::bond::{find_bond_address, Bond};
use validator_bonds::state::config::Config;

pub const BOND_ACCOUNT_SEED: &[u8; 12] = b"bond_account";

#[derive(Default)]
pub struct CommonCache {
    config_map: HashMap<Pubkey, ConfigData>,
    bond_map: HashMap<Pubkey, BondData>,
    stake_map: HashMap<Pubkey, StakeData>,
}

pub fn get_or_create_bond_account_for_config(
    common_cache: &mut CommonCache,
    bond_account_storage: &mut AccountsStorage<PdaStore>,
    bond_account_id: AccountId,
    client: &mut impl FuzzClient,
    config: Pubkey,
) -> (Pubkey, BondData) {
    let key = bond_account_storage
        .storage()
        .entry(bond_account_id)
        .or_insert_with(|| {
            let bond_data = set_bond(client, config);
            common_cache
                .bond_map
                .insert(bond_data.bond.pubkey, bond_data.clone());
            bond_data.bond
        });
    let bond = common_cache.bond_map.get(&key.pubkey()).unwrap().clone();
    (key.pubkey(), bond)
}

pub struct BondData {
    pub bond: PdaStore,
    pub bond_account: Bond,
    pub bond_authority: Keypair,
    pub vote_account: Keypair,
    pub node_identity: Keypair,
}

impl Clone for BondData {
    fn clone(&self) -> Self {
        BondData {
            bond: PdaStore {
                pubkey: self.bond.pubkey.clone(),
                seeds: self.bond.seeds.clone(),
            },
            bond_account: self.bond_account.clone(),
            bond_authority: self.bond_authority.clone(),
            vote_account: self.vote_account.clone(),
            node_identity: self.node_identity.clone(),
        }
    }
}

fn set_bond(client: &mut impl FuzzClient, config: Pubkey) -> BondData {
    let bond_authority = client.set_account(10 * LAMPORTS_PER_SOL);
    let node_identity = client.set_account(10 * LAMPORTS_PER_SOL);
    let vote_account = set_vote_account_with_node_pubkey(client, node_identity.pubkey());

    let (bond, bump) = find_bond_address(&config, &vote_account.pubkey());
    let bond_account = Bond {
        config,
        vote_account: vote_account.pubkey(),
        authority: bond_authority.pubkey(),
        cpmpe: 0,
        bump,
        max_stake_wanted: 0,
        reserved: [0; 134],
    };
    let mut data: Vec<u8> = vec![];
    bond_account.try_serialize(&mut data).unwrap();

    let rent = Rent::default();
    let lamports = rent.minimum_balance(data.len());
    client.set_account_custom(
        &bond,
        &AccountSharedData::create(lamports, data, validator_bonds::ID, false, 0),
    );

    BondData {
        bond: PdaStore {
            pubkey: bond,
            seeds: vec![
                BOND_ACCOUNT_SEED.to_vec(),
                config.try_to_vec().unwrap(),
                vote_account.clone().pubkey().try_to_vec().unwrap(),
            ],
        },
        bond_account,
        bond_authority,
        vote_account,
        node_identity,
    }
}

pub fn get_or_create_config_account(
    common_cache: &mut CommonCache,
    config_account_storage: &mut AccountsStorage<Keypair>,
    config_account_id: AccountId,
    client: &mut impl FuzzClient,
) -> (Pubkey, ConfigData) {
    let key = config_account_storage
        .storage()
        .entry(config_account_id)
        .or_insert_with(|| {
            let config_data = set_config(client);
            let keypair = config_data.config.clone();
            common_cache
                .config_map
                .insert(config_data.config.pubkey(), config_data);
            keypair
        });
    let config = common_cache.config_map.get(&key.pubkey()).unwrap().clone();
    (key.pubkey(), config)
}

pub struct ConfigData {
    pub config: Keypair,
    pub config_account: Config,
    pub admin_authority: Keypair,
    pub operator_authority: Keypair,
    pub pause_authority: Keypair,
}

impl Clone for ConfigData {
    fn clone(&self) -> Self {
        ConfigData {
            config: self.config.clone(),
            config_account: self.config_account.clone(),
            admin_authority: self.admin_authority.clone(),
            operator_authority: self.operator_authority.clone(),
            pause_authority: self.pause_authority.clone(),
        }
    }
}

pub fn set_config(client: &mut impl FuzzClient) -> ConfigData {
    let config = client.set_account(10 * LAMPORTS_PER_SOL);
    let admin_authority = client.set_account(10 * LAMPORTS_PER_SOL);
    let operator_authority = client.set_account(10 * LAMPORTS_PER_SOL);
    let pause_authority = client.set_account(10 * LAMPORTS_PER_SOL);

    // set config fields
    let config_account = Config {
        admin_authority: admin_authority.pubkey(),
        operator_authority: operator_authority.pubkey(),
        epochs_to_claim_settlement: 0,
        withdraw_lockup_epochs: 0,
        minimum_stake_lamports: 0,
        bonds_withdrawer_authority_bump: 0,
        pause_authority: pause_authority.pubkey(),
        paused: false,
        slots_to_start_settlement_claiming: 0,
        min_bond_max_stake_wanted: 0,
        reserved: [0; 463],
    };
    let mut data: Vec<u8> = vec![];
    config_account.try_serialize(&mut data).unwrap();

    let rent = Rent::default();
    let lamports = rent.minimum_balance(data.len());
    client.set_account_custom(
        &config.pubkey(),
        &AccountSharedData::create(lamports, data, validator_bonds::ID, false, 0),
    );
    ConfigData {
        config,
        config_account,
        admin_authority,
        operator_authority,
        pause_authority,
    }
}

/// Using the client to get or create vote account
/// And returning the VoteState data on it that are in client
pub fn get_or_create_vote_account(
    vote_accounts_storage: &mut AccountsStorage<Keypair>,
    vote_account_id: AccountId,
    client: &mut impl FuzzClient,
    node_pubkey: Pubkey,
) -> Option<(Pubkey, VoteState)> {
    let key = vote_accounts_storage
        .storage()
        .entry(vote_account_id)
        .or_insert_with(|| set_vote_account_with_node_pubkey(client, node_pubkey));
    let account = client
        .get_account(&key.pubkey())
        .expect("Failed to get vote account")
        .expect("Vote account not found");
    VoteState::deserialize(&account.data)
        .ok()
        .map(|vote_state| (key.pubkey(), vote_state))
}

fn set_vote_account_with_node_pubkey(client: &mut impl FuzzClient, node_pubkey: Pubkey) -> Keypair {
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

fn set_vote_account(
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
            node_pubkey,
            authorized_voter,
            authorized_withdrawer,
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

fn set_initialized_stake_account(client: &mut impl FuzzClient) -> Pubkey {
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
    common_cache: &mut CommonCache,
    stake_accounts_storage: &mut AccountsStorage<Keypair>,
    account_id: AccountId,
    client: &mut impl FuzzClient,
    vote_account: Pubkey,
) -> (Pubkey, StakeData) {
    let key = stake_accounts_storage
        .storage()
        .entry(account_id)
        .or_insert_with(|| {
            let stake_data = set_delegated_stake_accounts_with_defaults(client, vote_account);
            let keypair = stake_data.stake.clone();
            common_cache
                .stake_map
                .insert(stake_data.stake.pubkey(), stake_data);
            keypair
        });
    let stake = common_cache.stake_map.get(&key.pubkey()).unwrap().clone();
    (key.pubkey(), stake)
}

pub struct StakeData {
    pub stake: Keypair,
    pub withdrawer: Keypair,
    pub staker: Keypair,
    stake_account: StakeStateV2,
}

impl Clone for StakeData {
    fn clone(&self) -> Self {
        StakeData {
            stake: self.stake.clone(),
            withdrawer: self.withdrawer.clone(),
            staker: self.staker.clone(),
            stake_account: self.stake_account.clone(),
        }
    }
}

fn set_delegated_stake_accounts_with_defaults(
    client: &mut impl FuzzClient,
    vote_account: Pubkey,
) -> StakeData {
    let clock = Clock::default();
    let staker_authority = client.set_account(10 * LAMPORTS_PER_SOL);
    let withdrawer_authority = client.set_account(10 * LAMPORTS_PER_SOL);

    let (keypair, stake_state) = set_delegated_stake_account(
        client,
        vote_account,
        staker_authority.pubkey(),
        withdrawer_authority.pubkey(),
        100 * LAMPORTS_PER_SOL,
        clock.epoch,
        None,
    );
    StakeData {
        stake: keypair,
        withdrawer: withdrawer_authority,
        staker: staker_authority,
        stake_account: stake_state,
    }
}

fn set_delegated_stake_account(
    client: &mut impl FuzzClient,
    voter_pubkey: Pubkey, // vote account delegated to
    staker: Pubkey,
    withdrawer: Pubkey,
    stake: u64,
    activation_epoch: Epoch,
    deactivation_epoch: Option<Epoch>,
) -> (Keypair, StakeStateV2) {
    let stake_account_keypair = Keypair::new();

    let rent = Rent::default();
    let lamports = rent.minimum_balance(StakeStateV2::size_of());
    let minimum_delegation = LAMPORTS_PER_SOL; // TODO: maybe to load from solana
    let minimum_lamports = lamports + minimum_delegation;

    let stake_state = StakeStateV2::Stake(
        Meta {
            authorized: Authorized { staker, withdrawer },
            ..Meta::default()
        },
        Stake {
            delegation: Delegation {
                stake,
                activation_epoch,
                voter_pubkey,
                deactivation_epoch: if let Some(epoch) = deactivation_epoch {
                    epoch
                } else {
                    u64::MAX
                },
                ..Delegation::default()
            },
            ..Stake::default()
        },
        StakeFlags::default(),
    );
    let stake_account = AccountSharedData::new_data_with_space(
        if stake > minimum_lamports {
            stake
        } else {
            minimum_lamports
        },
        &stake_state,
        StakeStateV2::size_of(),
        &trident_client::fuzzing::solana_sdk::stake::program::ID,
    )
    .unwrap();

    client.set_account_custom(&stake_account_keypair.pubkey(), &stake_account);

    (stake_account_keypair, stake_state)
}

pub fn set_mint_account(
    client: &mut impl FuzzClient,
    mint_account: &Pubkey,
    decimals: u8,
    owner: &Pubkey,
    freeze_authority: Option<Pubkey>,
) {
    let authority = match freeze_authority {
        Some(a) => COption::Some(a),
        _ => COption::None,
    };

    let r = Rent::default();
    let lamports = r.minimum_balance(Mint::LEN);

    let mut account = AccountSharedData::new(lamports, Mint::LEN, &anchor_spl::token::ID);

    let mint = Mint {
        is_initialized: true,
        mint_authority: COption::Some(*owner),
        freeze_authority: authority,
        decimals,
        ..Default::default()
    };

    let mut data = vec![0u8; Mint::LEN];
    Mint::pack(mint, &mut data[..]).unwrap();
    account.set_data_from_slice(&data);
    client.set_account_custom(&mint_account, &account);
}
