use anchor_lang::solana_program::native_token::LAMPORTS_PER_SOL;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_lang::{AccountSerialize, AnchorSerialize};
use anchor_spl::token::spl_token;
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
use validator_bonds::state::config::{find_bonds_withdrawer_authority, Config};
use validator_bonds::state::settlement::{
    find_settlement_address, find_settlement_claims_address, find_settlement_staker_authority,
    Bumps, Settlement,
};
use validator_bonds::state::settlement_claims::{account_size, SettlementClaims};
use validator_bonds::state::withdraw_request::{find_withdraw_request_address, WithdrawRequest};

pub const BOND_ACCOUNT_SEED: &[u8; 12] = b"bond_account";

#[derive(Default)]
pub struct CommonCache {
    config_map: HashMap<Pubkey, ConfigData>,
    bond_map: HashMap<Pubkey, BondData>,
    stake_map: HashMap<Pubkey, StakeData>,
    // settlement_map: HashMap<Pubkey, SettlementData>,
}

pub fn set_settlement_claims(
    client: &mut impl FuzzClient,
    settlement: Pubkey,
    max_records: u64,
    full_account_size: bool,
) -> (Pubkey, SettlementClaims) {
    let settlement_claims_account = SettlementClaims {
        settlement,
        version: 0,
        max_records,
    };

    let mut data = vec![];
    settlement_claims_account.try_serialize(&mut data).unwrap();
    let account_size_to_set = if full_account_size {
        account_size(max_records)
    } else {
        account_size(0)
    };
    let mut splice_data = vec![0u8; account_size_to_set];
    splice_data[0..data.len()].copy_from_slice(&data);

    let (settlement_claims, _) = find_settlement_claims_address(&settlement);

    let rent = Rent::default();
    let lamports = rent.minimum_balance(splice_data.len());
    client.set_account_custom(
        &settlement_claims,
        &AccountSharedData::create(lamports, splice_data, validator_bonds::ID, false, u64::MAX),
    );
    (settlement_claims, settlement_claims_account)
}

pub fn set_settlement(
    client: &mut impl FuzzClient,
    bond: Pubkey,
    merkle_root: [u8; 32],
    max_total_claim: u64,
    max_merkle_nodes: u64,
    epoch: Epoch,
) -> (Pubkey, Settlement) {
    let (settlement, settlement_bump) = find_settlement_address(&bond, &merkle_root, epoch);
    let (staker, staker_bump) = find_settlement_staker_authority(&settlement);
    let (_, claims_bump) = find_settlement_claims_address(&settlement);
    let rent_collector = client.set_account(10 * LAMPORTS_PER_SOL);
    let clock = Clock::default();

    let settlement_account = Settlement {
        bond,
        staker_authority: staker,
        merkle_root,
        max_total_claim,
        max_merkle_nodes,
        lamports_funded: 0,
        lamports_claimed: 0,
        merkle_nodes_claimed: 0,
        epoch_created_for: epoch,
        slot_created_at: clock.slot,
        rent_collector: rent_collector.pubkey(),
        split_rent_collector: None,
        split_rent_amount: 0,
        bumps: Bumps {
            pda: settlement_bump,
            staker_authority: staker_bump,
            settlement_claims: claims_bump,
        },
        reserved: [0; 90],
    };

    let mut data = vec![];
    settlement_account.try_serialize(&mut data).unwrap();
    let mut splice_data = vec![0u8; 8 + std::mem::size_of::<Settlement>()];
    splice_data[0..data.len()].copy_from_slice(&data);

    let rent = Rent::default();
    let lamports = rent.minimum_balance(splice_data.len());
    client.set_account_custom(
        &settlement,
        &AccountSharedData::create(lamports, splice_data, validator_bonds::ID, false, u64::MAX),
    );
    (settlement, settlement_account)
}

pub fn set_withdraw_request(
    client: &mut impl FuzzClient,
    bond: Pubkey,
    vote_account: Pubkey,
    requested_amount: u64,
    withdrawn_amount: Option<u64>,
) -> (Pubkey, WithdrawRequest) {
    let (pubkey, bump) = find_withdraw_request_address(&bond);

    let withdraw_request_account = WithdrawRequest {
        vote_account,
        bond,
        epoch: 0,
        requested_amount,
        withdrawn_amount: withdrawn_amount.unwrap_or(0),
        bump,
        reserved: [0; 93],
    };
    let mut data = vec![];
    withdraw_request_account.try_serialize(&mut data).unwrap();
    let mut splice_data = vec![0u8; 8 + std::mem::size_of::<WithdrawRequest>()];
    splice_data[0..data.len()].copy_from_slice(&data);

    let rent = Rent::default();
    let lamports = rent.minimum_balance(splice_data.len());
    client.set_account_custom(
        &pubkey,
        &AccountSharedData::create(lamports, splice_data, validator_bonds::ID, false, u64::MAX),
    );
    (pubkey, withdraw_request_account)
}

pub fn get_or_create_bond_account_for_config(
    common_cache: &mut CommonCache,
    bond_account_storage: &mut AccountsStorage<PdaStore>,
    bond_account_id: AccountId,
    config_account_storage: &mut AccountsStorage<Keypair>,
    config_account_id: AccountId,
    client: &mut impl FuzzClient,
) -> (BondData, ConfigData) {
    let key = bond_account_storage
        .storage()
        .entry(bond_account_id)
        .or_insert_with(|| {
            // we haven't found the bond, let's try to find the config account (if not creating it)
            let config = get_or_create_config_account(
                common_cache,
                config_account_storage,
                config_account_id,
                client,
            );
            let bond_data = set_bond(client, config.config.pubkey());
            common_cache
                .bond_map
                .insert(bond_data.bond.pubkey, bond_data.clone());
            bond_data.bond
        });
    let bond = common_cache.bond_map.get(&key.pubkey()).unwrap().clone();
    let config = common_cache
        .config_map
        .get(&bond.bond_account.config)
        .unwrap()
        .clone();
    (bond, config)
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
                pubkey: self.bond.pubkey,
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
    let mut data = vec![];
    bond_account.try_serialize(&mut data).unwrap();
    let mut splice_data = vec![0u8; 8 + std::mem::size_of::<Bond>()];
    splice_data[0..data.len()].copy_from_slice(&data);

    let rent = Rent::default();
    let lamports = rent.minimum_balance(splice_data.len());
    client.set_account_custom(
        &bond,
        &AccountSharedData::create(lamports, splice_data, validator_bonds::ID, false, u64::MAX),
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
) -> ConfigData {
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
    common_cache.config_map.get(&key.pubkey()).unwrap().clone()
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
    set_config_with_modify(client, |_| {})
}

pub fn set_config_with_modify(
    client: &mut impl FuzzClient,
    modifier: impl FnOnce(&mut Config),
) -> ConfigData {
    let config = client.set_account(10 * LAMPORTS_PER_SOL);
    let admin_authority = client.set_account(10 * LAMPORTS_PER_SOL);
    let operator_authority = client.set_account(10 * LAMPORTS_PER_SOL);
    let pause_authority = client.set_account(10 * LAMPORTS_PER_SOL);

    let bonds_withdrawer_authority_bump = find_bonds_withdrawer_authority(&config.pubkey()).1;

    // set config fields
    let mut config_account = Config {
        admin_authority: admin_authority.pubkey(),
        operator_authority: operator_authority.pubkey(),
        epochs_to_claim_settlement: 0,
        withdraw_lockup_epochs: 0,
        minimum_stake_lamports: LAMPORTS_PER_SOL,
        bonds_withdrawer_authority_bump,
        pause_authority: pause_authority.pubkey(),
        paused: false,
        slots_to_start_settlement_claiming: 0,
        min_bond_max_stake_wanted: 0,
        reserved: [0; 463],
    };

    modifier(&mut config_account);

    let mut data = vec![];
    config_account.try_serialize(&mut data).unwrap();
    let _data_size = 8 + std::mem::size_of::<Config>();
    let mut splice_data = vec![0u8; 8 + std::mem::size_of::<Config>()];
    splice_data[0..data.len()].copy_from_slice(&data);
    let _is_same = data == splice_data[0..data.len()].to_vec();

    let rent = Rent::default();
    let lamports = rent.minimum_balance(splice_data.len());
    client.set_account_custom(
        &config.pubkey(),
        &AccountSharedData::create(lamports, splice_data, validator_bonds::ID, false, u64::MAX),
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
) -> (Pubkey, VoteState) {
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
        .unwrap()
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

pub fn get_or_create_delegated_stake_account(
    common_cache: &mut CommonCache,
    stake_accounts_storage: &mut AccountsStorage<Keypair>,
    account_id: AccountId,
    client: &mut impl FuzzClient,
    vote_account: Pubkey,
    amount: u64,
) -> (Pubkey, StakeData) {
    let key = stake_accounts_storage
        .storage()
        .entry(account_id)
        .or_insert_with(|| {
            let stake_data =
                set_delegated_stake_accounts_with_defaults(client, vote_account, amount);
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
            stake_account: self.stake_account,
        }
    }
}

fn set_delegated_stake_accounts_with_defaults(
    client: &mut impl FuzzClient,
    vote_account: Pubkey,
    amount: u64,
) -> StakeData {
    let clock = Clock::default();
    let staker_authority = client.set_account(10 * LAMPORTS_PER_SOL);
    let withdrawer_authority = client.set_account(10 * LAMPORTS_PER_SOL);

    let (keypair, stake_state) = set_delegated_stake_account(
        client,
        vote_account,
        staker_authority.pubkey(),
        withdrawer_authority.pubkey(),
        amount,
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

pub fn set_delegated_stake_account(
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
    supply: u64,
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
        supply,
        decimals,
    };

    let mut data = vec![0u8; Mint::LEN];
    Mint::pack(mint, &mut data[..]).unwrap();
    account.set_data_from_slice(&data);
    client.set_account_custom(mint_account, &account);
}

#[allow(clippy::too_many_arguments)]
pub fn set_token_account(
    client: &mut impl FuzzClient,
    token_account: &Pubkey,
    mint: Pubkey,
    owner: Pubkey,
    amount: u64,
    delegate: Option<Pubkey>,
    is_native: Option<u64>,
    delegated_amount: u64,
    close_authority: Option<Pubkey>,
) {
    let delegate = match delegate {
        Some(a) => COption::Some(a),
        _ => COption::None,
    };

    let is_native = match is_native {
        Some(a) => COption::Some(a),
        _ => COption::None,
    };

    let close_authority = match close_authority {
        Some(a) => COption::Some(a),
        _ => COption::None,
    };

    let r = Rent::default();
    let lamports = r.minimum_balance(spl_token::state::Account::LEN);

    let mut account =
        AccountSharedData::new(lamports, spl_token::state::Account::LEN, &spl_token::id());

    let token = spl_token::state::Account {
        mint,
        owner,
        amount,
        delegate,
        state: spl_token::state::AccountState::Initialized,
        is_native,
        delegated_amount,
        close_authority,
    };

    let mut data = vec![0u8; spl_token::state::Account::LEN];
    spl_token::state::Account::pack(token, &mut data[..]).unwrap();
    account.set_data_from_slice(&data);
    client.set_account_custom(token_account, &account);
}

pub fn to_option<T>(item: COption<T>) -> Option<T> {
    match item {
        COption::Some(a) => Some(a),
        _ => None,
    }
}
