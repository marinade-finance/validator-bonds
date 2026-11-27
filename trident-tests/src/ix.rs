//! Raw instruction builders for the validator-bonds program (account order follows the IDL).

use borsh::BorshSerialize;
use trident_fuzz::fuzzing::*;

pub const PROGRAM_ID: Pubkey = pubkey!("vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4");
pub const SYSTEM: Pubkey = pubkey!("11111111111111111111111111111111");
pub const STAKE_PROGRAM: Pubkey = pubkey!("Stake11111111111111111111111111111111111111");
pub const STAKE_CONFIG: Pubkey = pubkey!("StakeConfig11111111111111111111111111111111");
pub const VOTE_PROGRAM: Pubkey = pubkey!("Vote111111111111111111111111111111111111111");
pub const CLOCK: Pubkey = pubkey!("SysvarC1ock11111111111111111111111111111111");
pub const RENT: Pubkey = pubkey!("SysvarRent111111111111111111111111111111111");
pub const STAKE_HISTORY: Pubkey = pubkey!("SysvarStakeHistory1111111111111111111111111");
pub const TOKEN_PROGRAM: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const ATA_PROGRAM: Pubkey = pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
pub const METADATA_PROGRAM: Pubkey = pubkey!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
pub const MARINADE_LIQUID_PROGRAM: Pubkey = pubkey!("MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD");
pub const MARINADE_LIQUID_STATE: Pubkey = pubkey!("8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC");
pub const MARINADE_STAKE_LIST: Pubkey = pubkey!("Anv3XE7e5saNdm16MU6bniYS59Mpv7DzQXHAhxJUmAKW");
pub const MARINADE_WITHDRAW_AUTH: Pubkey = pubkey!("9eG63CdHjsfhHmobHgLtESGC8GabbmRcaSpHAZrtmhco");

pub fn event_authority() -> Pubkey {
    Pubkey::find_program_address(&[b"__event_authority"], &PROGRAM_ID).0
}
pub fn bonds_authority(config: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"bonds_authority", config.as_ref()], &PROGRAM_ID).0
}
pub fn bond_address(config: &Pubkey, vote: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"bond_account", config.as_ref(), vote.as_ref()],
        &PROGRAM_ID,
    )
    .0
}
pub fn bond_mint(bond: &Pubkey, identity: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"bond_mint", bond.as_ref(), identity.as_ref()],
        &PROGRAM_ID,
    )
    .0
}
pub fn bond_product_address(bond: &Pubkey, seed: &[u8]) -> Pubkey {
    Pubkey::find_program_address(&[b"bond_product", bond.as_ref(), seed], &PROGRAM_ID).0
}
pub fn withdraw_request_address(bond: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"withdraw_account", bond.as_ref()], &PROGRAM_ID).0
}
pub fn settlement_address(bond: &Pubkey, root: &[u8; 32], epoch: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[
            b"settlement_account",
            bond.as_ref(),
            root,
            &epoch.to_le_bytes(),
        ],
        &PROGRAM_ID,
    )
    .0
}
pub fn settlement_claims_address(settlement: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"claims_account", settlement.as_ref()], &PROGRAM_ID).0
}
pub fn settlement_staker_authority(settlement: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"settlement_authority", settlement.as_ref()], &PROGRAM_ID).0
}
pub fn ata(wallet: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[wallet.as_ref(), TOKEN_PROGRAM.as_ref(), mint.as_ref()],
        &ATA_PROGRAM,
    )
    .0
}
pub fn metadata_address(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"metadata", METADATA_PROGRAM.as_ref(), mint.as_ref()],
        &METADATA_PROGRAM,
    )
    .0
}

fn disc(name: &str) -> [u8; 8] {
    use sha2::{Digest, Sha256};
    let h = Sha256::digest(format!("global:{name}").as_bytes());
    h[..8].try_into().unwrap()
}

fn data<T: BorshSerialize>(name: &str, args: &T) -> Vec<u8> {
    let mut d = disc(name).to_vec();
    args.serialize(&mut d).unwrap();
    d
}

fn ro(k: Pubkey) -> AccountMeta {
    AccountMeta::new_readonly(k, false)
}
fn w(k: Pubkey) -> AccountMeta {
    AccountMeta::new(k, false)
}
fn s(k: Pubkey) -> AccountMeta {
    AccountMeta::new_readonly(k, true)
}
fn ws(k: Pubkey) -> AccountMeta {
    AccountMeta::new(k, true)
}
/// Anchor encodes a missing optional account as the program id.
fn opt(k: Option<Pubkey>) -> AccountMeta {
    ro(k.unwrap_or(PROGRAM_ID))
}
fn ev() -> Vec<AccountMeta> {
    vec![ro(event_authority()), ro(PROGRAM_ID)]
}

fn build(
    name: &str,
    args: &impl BorshSerialize,
    mut accounts: Vec<AccountMeta>,
    with_event: bool,
) -> Instruction {
    if with_event {
        accounts.extend(ev());
    }
    Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data: data(name, args),
    }
}

// ---- args -----------------------------------------------------------------

#[derive(BorshSerialize, Clone, Debug)]
pub struct InitConfigArgs {
    pub admin_authority: Pubkey,
    pub operator_authority: Pubkey,
    pub epochs_to_claim_settlement: u64,
    pub withdraw_lockup_epochs: u64,
    pub slots_to_start_settlement_claiming: u64,
}

#[derive(BorshSerialize, Clone, Debug, Default)]
pub struct ConfigureConfigArgs {
    pub admin: Option<Pubkey>,
    pub operator: Option<Pubkey>,
    pub pause_authority: Option<Pubkey>,
    pub epochs_to_claim_settlement: Option<u64>,
    pub withdraw_lockup_epochs: Option<u64>,
    pub minimum_stake_lamports: Option<u64>,
    pub slots_to_start_settlement_claiming: Option<u64>,
    pub min_bond_max_stake_wanted: Option<u64>,
}

#[derive(BorshSerialize, Clone, Debug)]
pub struct InitBondArgs {
    pub bond_authority: Pubkey,
    pub cpmpe: u64,
    pub max_stake_wanted: u64,
}

#[derive(BorshSerialize, Clone, Debug, Default)]
pub struct ConfigureBondArgs {
    pub bond_authority: Option<Pubkey>,
    pub cpmpe: Option<u64>,
    pub max_stake_wanted: Option<u64>,
}

#[derive(BorshSerialize, Clone, Debug)]
pub struct ConfigureBondWithMintArgs {
    pub validator_identity: Pubkey,
    pub bond_authority: Option<Pubkey>,
    pub cpmpe: Option<u64>,
    pub max_stake_wanted: Option<u64>,
}

#[derive(BorshSerialize, Clone, Debug)]
pub enum ProductType {
    Commission,
    Custom(String),
}
impl ProductType {
    pub fn seed(&self) -> Vec<u8> {
        match self {
            ProductType::Commission => b"commission".to_vec(),
            ProductType::Custom(n) => n.as_bytes().to_vec(),
        }
    }
}
#[derive(BorshSerialize, Clone, Debug, Default)]
pub struct CommissionProductConfig {
    pub inflation_bps: Option<i64>,
    pub mev_bps: Option<i64>,
    pub block_bps: Option<i64>,
}
#[derive(BorshSerialize, Clone, Debug)]
pub enum ProductTypeConfig {
    Commission(CommissionProductConfig),
    Custom(Vec<u8>),
}
#[derive(BorshSerialize, Clone, Debug)]
pub struct InitBondProductArgs {
    pub product_type: ProductType,
    pub config_data: ProductTypeConfig,
}
#[derive(BorshSerialize, Clone, Debug)]
pub struct ConfigureBondProductArgs {
    pub config_data: ProductTypeConfig,
}

#[derive(BorshSerialize, Clone, Debug)]
pub struct InitSettlementArgs {
    pub merkle_root: [u8; 32],
    pub max_total_claim: u64,
    pub max_merkle_nodes: u64,
    pub rent_collector: Pubkey,
    pub epoch: u64,
}

#[derive(BorshSerialize, Clone, Debug)]
pub struct ClaimSettlementV2Args {
    pub proof: Vec<[u8; 32]>,
    pub tree_node_hash: [u8; 32],
    pub stake_account_staker: Pubkey,
    pub stake_account_withdrawer: Pubkey,
    pub claim: u64,
    pub index: u64,
}

// ---- builders ---------------------------------------------------------------

pub fn init_config(config: Pubkey, rent_payer: Pubkey, a: &InitConfigArgs) -> Instruction {
    build(
        "init_config",
        a,
        vec![ws(config), ws(rent_payer), ro(SYSTEM)],
        true,
    )
}

pub fn configure_config(config: Pubkey, admin: Pubkey, a: &ConfigureConfigArgs) -> Instruction {
    build("configure_config", a, vec![w(config), s(admin)], true)
}

pub fn emergency_pause(config: Pubkey, authority: Pubkey) -> Instruction {
    build("emergency_pause", &(), vec![w(config), s(authority)], true)
}

pub fn emergency_resume(config: Pubkey, authority: Pubkey) -> Instruction {
    build("emergency_resume", &(), vec![w(config), s(authority)], true)
}

pub fn init_bond(
    config: Pubkey,
    vote: Pubkey,
    validator_identity: Option<Pubkey>,
    bond: Pubkey,
    rent_payer: Pubkey,
    a: &InitBondArgs,
) -> Instruction {
    let identity = match validator_identity {
        Some(k) => s(k),
        None => ro(PROGRAM_ID),
    };
    build(
        "init_bond",
        a,
        vec![
            ro(config),
            ro(vote),
            identity,
            w(bond),
            ws(rent_payer),
            ro(SYSTEM),
        ],
        true,
    )
}

pub fn configure_bond(
    config: Pubkey,
    bond: Pubkey,
    authority: Pubkey,
    vote: Pubkey,
    a: &ConfigureBondArgs,
) -> Instruction {
    build(
        "configure_bond",
        a,
        vec![ro(config), w(bond), s(authority), ro(vote)],
        true,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn mint_bond(
    config: Pubkey,
    bond: Pubkey,
    validator_identity: Pubkey,
    vote: Pubkey,
    rent_payer: Pubkey,
) -> Instruction {
    let mint = bond_mint(&bond, &validator_identity);
    build(
        "mint_bond",
        &(),
        vec![
            ro(config),
            ro(bond),
            w(mint),
            ro(validator_identity),
            w(ata(&validator_identity, &mint)),
            ro(vote),
            w(metadata_address(&mint)),
            ws(rent_payer),
            ro(SYSTEM),
            ro(TOKEN_PROGRAM),
            ro(ATA_PROGRAM),
            ro(METADATA_PROGRAM),
            ro(RENT),
        ],
        true,
    )
}

pub fn configure_bond_with_mint(
    config: Pubkey,
    bond: Pubkey,
    vote: Pubkey,
    mint: Pubkey,
    token_account: Pubkey,
    token_authority: Pubkey,
    a: &ConfigureBondWithMintArgs,
) -> Instruction {
    build(
        "configure_bond_with_mint",
        a,
        vec![
            ro(config),
            w(bond),
            w(mint),
            ro(vote),
            w(token_account),
            s(token_authority),
            ro(TOKEN_PROGRAM),
        ],
        true,
    )
}

pub fn init_bond_product(
    config: Pubkey,
    bond: Pubkey,
    vote: Pubkey,
    product: Pubkey,
    authority: Option<Pubkey>,
    rent_payer: Pubkey,
    a: &InitBondProductArgs,
) -> Instruction {
    let auth = match authority {
        Some(k) => s(k),
        None => ro(PROGRAM_ID),
    };
    build(
        "init_bond_product",
        a,
        vec![
            ro(config),
            w(bond),
            ro(vote),
            w(product),
            auth,
            ws(rent_payer),
            ro(SYSTEM),
        ],
        true,
    )
}

pub fn configure_bond_product(
    config: Pubkey,
    bond: Pubkey,
    vote: Pubkey,
    product: Pubkey,
    authority: Pubkey,
    a: &ConfigureBondProductArgs,
) -> Instruction {
    build(
        "configure_bond_product",
        a,
        vec![ro(config), ro(bond), ro(vote), w(product), s(authority)],
        true,
    )
}

pub fn fund_bond(
    config: Pubkey,
    bond: Pubkey,
    stake: Pubkey,
    stake_authority: Pubkey,
) -> Instruction {
    build(
        "fund_bond",
        &(),
        vec![
            ro(config),
            ro(bond),
            ro(bonds_authority(&config)),
            w(stake),
            s(stake_authority),
            ro(CLOCK),
            ro(STAKE_HISTORY),
            ro(STAKE_PROGRAM),
        ],
        true,
    )
}

pub fn init_withdraw_request(
    config: Pubkey,
    bond: Pubkey,
    vote: Pubkey,
    authority: Pubkey,
    rent_payer: Pubkey,
    amount: u64,
) -> Instruction {
    build(
        "init_withdraw_request",
        &amount,
        vec![
            ro(config),
            ro(bond),
            ro(vote),
            s(authority),
            w(withdraw_request_address(&bond)),
            ws(rent_payer),
            ro(SYSTEM),
        ],
        true,
    )
}

pub fn cancel_withdraw_request(
    config: Pubkey,
    bond: Pubkey,
    vote: Pubkey,
    authority: Pubkey,
    rent_collector: Pubkey,
) -> Instruction {
    build(
        "cancel_withdraw_request",
        &(),
        vec![
            ro(config),
            ro(bond),
            ro(vote),
            s(authority),
            w(withdraw_request_address(&bond)),
            w(rent_collector),
        ],
        true,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn claim_withdraw_request(
    config: Pubkey,
    bond: Pubkey,
    vote: Pubkey,
    authority: Pubkey,
    stake: Pubkey,
    withdrawer: Pubkey,
    split_stake: Pubkey,
    split_rent_payer: Pubkey,
) -> Instruction {
    build(
        "claim_withdraw_request",
        &(),
        vec![
            ro(config),
            ro(bond),
            ro(vote),
            s(authority),
            w(withdraw_request_address(&bond)),
            ro(bonds_authority(&config)),
            w(stake),
            ro(withdrawer),
            ws(split_stake),
            ws(split_rent_payer),
            ro(STAKE_PROGRAM),
            ro(SYSTEM),
            ro(STAKE_HISTORY),
            ro(CLOCK),
        ],
        true,
    )
}

pub fn init_settlement(
    config: Pubkey,
    bond: Pubkey,
    operator: Pubkey,
    rent_payer: Pubkey,
    a: &InitSettlementArgs,
) -> Instruction {
    let settlement = settlement_address(&bond, &a.merkle_root, a.epoch);
    build(
        "init_settlement",
        a,
        vec![
            ro(config),
            ro(bond),
            w(settlement),
            w(settlement_claims_address(&settlement)),
            s(operator),
            ws(rent_payer),
            ro(SYSTEM),
        ],
        true,
    )
}

pub fn upsize_settlement_claims(claims: Pubkey, rent_payer: Pubkey) -> Instruction {
    build(
        "upsize_settlement_claims",
        &(),
        vec![w(claims), ws(rent_payer), ro(SYSTEM)],
        false,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn fund_settlement(
    config: Pubkey,
    bond: Pubkey,
    vote: Pubkey,
    settlement: Pubkey,
    operator: Pubkey,
    stake: Pubkey,
    split_stake: Pubkey,
    split_rent_payer: Pubkey,
) -> Instruction {
    build(
        "fund_settlement",
        &(),
        vec![
            ro(config),
            ro(bond),
            ro(vote),
            w(settlement),
            s(operator),
            w(stake),
            ro(settlement_staker_authority(&settlement)),
            ro(bonds_authority(&config)),
            ws(split_stake),
            ws(split_rent_payer),
            ro(SYSTEM),
            ro(STAKE_HISTORY),
            ro(CLOCK),
            ro(RENT),
            ro(STAKE_PROGRAM),
            ro(STAKE_CONFIG),
        ],
        true,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn claim_settlement_v2(
    config: Pubkey,
    bond: Pubkey,
    settlement: Pubkey,
    stake_from: Pubkey,
    stake_to: Pubkey,
    liquid_state: Option<Pubkey>,
    liquid_list: Option<Pubkey>,
    a: &ClaimSettlementV2Args,
) -> Instruction {
    build(
        "claim_settlement_v2",
        a,
        vec![
            ro(config),
            ro(bond),
            w(settlement),
            w(settlement_claims_address(&settlement)),
            w(stake_from),
            w(stake_to),
            ro(bonds_authority(&config)),
            ro(STAKE_HISTORY),
            ro(CLOCK),
            ro(STAKE_PROGRAM),
            opt(liquid_state),
            opt(liquid_list),
        ],
        true,
    )
}

#[allow(clippy::too_many_arguments)]
fn close_like(
    name: &str,
    config: Pubkey,
    bond: Pubkey,
    settlement: Pubkey,
    rent_collector: Pubkey,
    split_rent_collector: Pubkey,
    split_rent_refund: Pubkey,
    authority: Option<Pubkey>,
) -> Instruction {
    let mut accounts = vec![
        if authority.is_some() {
            w(config)
        } else {
            ro(config)
        },
        ro(bond),
        w(settlement),
        w(settlement_claims_address(&settlement)),
    ];
    if let Some(a) = authority {
        accounts.push(s(a));
    }
    accounts.extend([
        ro(bonds_authority(&config)),
        w(rent_collector),
        w(split_rent_collector),
        w(split_rent_refund),
        ro(CLOCK),
        ro(STAKE_PROGRAM),
        ro(STAKE_HISTORY),
    ]);
    build(name, &(), accounts, true)
}

pub fn close_settlement_v2(
    config: Pubkey,
    bond: Pubkey,
    settlement: Pubkey,
    rent_collector: Pubkey,
    split_rent_collector: Pubkey,
    split_rent_refund: Pubkey,
) -> Instruction {
    close_like(
        "close_settlement_v2",
        config,
        bond,
        settlement,
        rent_collector,
        split_rent_collector,
        split_rent_refund,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn cancel_settlement(
    config: Pubkey,
    bond: Pubkey,
    settlement: Pubkey,
    authority: Pubkey,
    rent_collector: Pubkey,
    split_rent_collector: Pubkey,
    split_rent_refund: Pubkey,
) -> Instruction {
    close_like(
        "cancel_settlement",
        config,
        bond,
        settlement,
        rent_collector,
        split_rent_collector,
        split_rent_refund,
        Some(authority),
    )
}

pub fn merge_stake(
    config: Pubkey,
    source: Pubkey,
    destination: Pubkey,
    staker_authority: Pubkey,
    settlement: Pubkey,
) -> Instruction {
    build(
        "merge_stake",
        &settlement,
        vec![
            ro(config),
            w(source),
            w(destination),
            ro(staker_authority),
            ro(STAKE_HISTORY),
            ro(CLOCK),
            ro(STAKE_PROGRAM),
        ],
        true,
    )
}

pub fn reset_stake(
    config: Pubkey,
    bond: Pubkey,
    settlement: Pubkey,
    stake: Pubkey,
    vote: Pubkey,
) -> Instruction {
    build(
        "reset_stake",
        &(),
        vec![
            ro(config),
            ro(bond),
            ro(settlement),
            w(stake),
            ro(bonds_authority(&config)),
            ro(vote),
            ro(STAKE_HISTORY),
            ro(STAKE_CONFIG),
            ro(CLOCK),
            ro(STAKE_PROGRAM),
        ],
        true,
    )
}

pub fn withdraw_stake(
    config: Pubkey,
    operator: Pubkey,
    settlement: Pubkey,
    stake: Pubkey,
    withdraw_to: Pubkey,
) -> Instruction {
    build(
        "withdraw_stake",
        &(),
        vec![
            ro(config),
            s(operator),
            ro(settlement),
            w(stake),
            ro(bonds_authority(&config)),
            w(withdraw_to),
            ro(STAKE_HISTORY),
            ro(CLOCK),
            ro(STAKE_PROGRAM),
        ],
        true,
    )
}
