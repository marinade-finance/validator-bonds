//! Deterministic reproductions of problems found by the fuzzer.
//! Run from `trident-tests/`: `cargo test --release` (needs `target/deploy/validator_bonds.so`).

use solana_stake_interface::state::Lockup;
use trident_fuzz::fuzzing::*;
use validator_bonds_fuzz::ix::*;
use validator_bonds_fuzz::merkle::{Leaf, Tree};
use validator_bonds_fuzz::state::*;
use validator_bonds_fuzz::world::{World, SOL};

fn env() -> (Trident, World) {
    let mut t = Trident::default();
    let mut w = World::empty(&t);
    w.setup(&mut t, 4);
    assert!(w.init_config(&mut t).ok);
    for vi in 0..3 {
        let v = w.votes[vi].clone();
        let a = InitBondArgs {
            bond_authority: w.actors[2 + vi],
            cpmpe: 0,
            max_stake_wanted: 0,
        };
        assert!(
            w.exec(
                &mut t,
                "init_bond",
                init_bond(w.config, v.vote, Some(v.identity), v.bond, w.payer, &a)
            )
            .ok
        );
    }
    (t, w)
}

fn vote_junk(t: &mut Trident, len: usize) -> Pubkey {
    let k = t.random_pubkey();
    t.set_account_custom(&k, &AccountSharedData::new(10 * SOL, len, &VOTE_PROGRAM));
    k
}

/// A vote-program-owned account that is too short to hold a validator identity.
#[test]
fn short_vote_account_is_rejected_without_panic() {
    let (mut t, mut w) = env();
    for len in [0usize, 1, 3, 4, 35] {
        let vote = vote_junk(&mut t, len);
        let bond = bond_address(&w.config, &vote);
        let a = InitBondArgs {
            bond_authority: w.admin,
            cpmpe: 0,
            max_stake_wanted: 0,
        };
        let e = w.exec(
            &mut t,
            "init_bond",
            init_bond(w.config, vote, None, bond, w.payer, &a),
        );
        assert!(!e.ok, "len {len}: junk vote account must not create a bond");
    }
}

const PAUSED_CODE: u32 = 6054;
const STAKE_TOO_SMALL: u32 = 6031;
const CLAIM_EXCEEDS_MAX: u32 = 6032;
const WITHDRAW_NOT_READY: u32 = 6021;
const NOT_EXPIRED: u32 = 6022;
const PRODUCT_MISMATCH: u32 = 6075;

/// Never panics and fails with exactly `code`.
fn assert_fails_with(e: &validator_bonds_fuzz::world::Exec, code: u32) {
    assert!(!e.ok, "expected failure {code}, got success");
    assert_eq!(e.code, Some(code), "{} {}", e.err, e.logs);
}

fn configure(t: &mut Trident, w: &mut World, a: ConfigureConfigArgs) {
    let ix = configure_config(w.config, w.admin, &a);
    assert!(w.exec(t, "configure_config", ix).ok);
}

/// Stake funded to the bond of vote account 0.
fn funded_stake(t: &mut Trident, w: &mut World, lamports_delegated: u64) -> Pubkey {
    w.ensure_funded_stake(t, 0, lamports_delegated)
        .expect("fund_bond")
}

struct Settle {
    addr: Pubkey,
    leaves: Vec<Leaf>,
    tree: Tree,
    dest: Vec<Pubkey>,
}

fn settlement(t: &mut Trident, w: &mut World, claims: &[u64], max_total: Option<u64>) -> Settle {
    let epoch = t.get_sysvar::<solana_sdk::clock::Clock>().epoch;
    let mut leaves = vec![];
    let mut dest = vec![];
    for (i, c) in claims.iter().enumerate() {
        let (staker, withdrawer) = (t.random_pubkey(), t.random_pubkey());
        leaves.push(Leaf {
            staker,
            withdrawer,
            claim: *c,
            index: i as u64,
        });
        let d = t.random_pubkey();
        t.set_account_custom(
            &d,
            &make_stake(
                None,
                staker,
                withdrawer,
                Lockup::default(),
                0,
                0,
                Activation::Active,
                epoch,
            ),
        );
        dest.push(d);
    }
    let tree = Tree::new(&leaves);
    let args = InitSettlementArgs {
        merkle_root: tree.root(),
        max_total_claim: max_total.unwrap_or(claims.iter().sum()),
        max_merkle_nodes: claims.len() as u64,
        rent_collector: w.admin,
        epoch,
    };
    let v = w.votes[0].clone();
    let ix = init_settlement(w.config, v.bond, w.operator, w.payer, &args);
    assert!(w.exec(t, "init_settlement", ix).ok);
    Settle {
        addr: settlement_address(&v.bond, &args.merkle_root, epoch),
        leaves,
        tree,
        dest,
    }
}

fn fund(
    t: &mut Trident,
    w: &mut World,
    s: &Settle,
    stake: Pubkey,
) -> validator_bonds_fuzz::world::Exec {
    let v = w.votes[0].clone();
    let split = t.random_pubkey();
    let ix = fund_settlement(
        w.config, v.bond, v.vote, s.addr, w.operator, stake, split, w.payer,
    );
    w.exec(t, "fund_settlement", ix)
}

fn claim(
    t: &mut Trident,
    w: &mut World,
    s: &Settle,
    i: usize,
    stake_from: Pubkey,
) -> validator_bonds_fuzz::world::Exec {
    let l = &s.leaves[i];
    let a = ClaimSettlementV2Args {
        proof: s.tree.proof(i),
        tree_node_hash: l.node_hash(),
        stake_account_staker: l.staker,
        stake_account_withdrawer: l.withdrawer,
        claim: l.claim,
        index: l.index,
    };
    let ix = claim_settlement_v2(
        w.config,
        w.votes[0].bond,
        s.addr,
        stake_from,
        s.dest[i],
        None,
        None,
        &a,
    );
    w.exec(t, "claim_settlement_v2", ix)
}

fn next_epoch(t: &mut Trident) {
    let c = t.get_sysvar::<solana_sdk::clock::Clock>();
    t.warp_to_epoch(c.epoch + 1);
    // past the longest settlement claiming delay `World::init_config` picks (3000 slots)
    t.warp_to_slot(c.slot + 4000);
}

#[test]
fn init_bond_product_type_mismatch_is_an_error() {
    let (mut t, mut w) = env();
    let v = w.votes[0].clone();
    let a = InitBondProductArgs {
        product_type: ProductType::Commission,
        config_data: ProductTypeConfig::Custom(vec![1]),
    };
    let product = bond_product_address(&v.bond, &a.product_type.seed());
    let e = w.exec(
        &mut t,
        "init_bond_product",
        init_bond_product(
            w.config,
            v.bond,
            v.vote,
            product,
            Some(w.actors[2]),
            w.payer,
            &a,
        ),
    );
    assert_fails_with(&e, PRODUCT_MISMATCH);
}

/// Open: a custom product name above the 32 byte seed limit cannot be derived as a PDA and aborts the program.
#[test]
#[ignore = "known open issue, see trident-tests/README.md"]
fn init_bond_product_long_custom_name_is_an_error() {
    let (mut t, mut w) = env();
    let v = w.votes[0].clone();
    let a = InitBondProductArgs {
        product_type: ProductType::Custom("x".repeat(33)),
        config_data: ProductTypeConfig::Custom(vec![1]),
    };
    // a name above the 32 byte seed limit has no PDA: any address is wrong
    let product = t.random_pubkey();
    let e = w.exec(
        &mut t,
        "init_bond_product",
        init_bond_product(
            w.config,
            v.bond,
            v.vote,
            product,
            Some(w.actors[2]),
            w.payer,
            &a,
        ),
    );
    assert!(!e.ok);
}

#[test]
fn fund_settlement_with_stake_below_minimum_is_an_error() {
    let (mut t, mut w) = env();
    let stake = funded_stake(&mut t, &mut w, SOL / 5); // below the 1 SOL minimum stake
    let s = settlement(&mut t, &mut w, &[SOL / 10], None);
    assert_fails_with(&fund(&mut t, &mut w, &s, stake), STAKE_TOO_SMALL);
}

#[test]
fn fund_settlement_with_huge_minimum_stake_is_an_error() {
    let (mut t, mut w) = env();
    let stake = funded_stake(&mut t, &mut w, 5 * SOL);
    configure(
        &mut t,
        &mut w,
        ConfigureConfigArgs {
            minimum_stake_lamports: Some(u64::MAX),
            ..Default::default()
        },
    );
    let s = settlement(&mut t, &mut w, &[SOL / 10], None);
    assert_fails_with(&fund(&mut t, &mut w, &s, stake), STAKE_TOO_SMALL);
}

#[test]
fn fund_settlement_with_max_total_claim_near_u64_max_does_not_overflow() {
    let (mut t, mut w) = env();
    let stake = funded_stake(&mut t, &mut w, 5 * SOL);
    let s = settlement(&mut t, &mut w, &[SOL / 10], Some(u64::MAX));
    let e = fund(&mut t, &mut w, &s, stake);
    assert!(e.ok, "{} {}", e.err, e.logs);
}

#[test]
fn claim_with_overflowing_amount_is_an_error() {
    let (mut t, mut w) = env();
    let stake = funded_stake(&mut t, &mut w, 10 * SOL);
    // second leaf claims u64::MAX; the tree and its hash are consistent, only the total check can reject it
    let s = settlement(&mut t, &mut w, &[SOL / 10, u64::MAX / 2], Some(u64::MAX));
    assert!(fund(&mut t, &mut w, &s, stake).ok);
    next_epoch(&mut t);
    let stake_funded = {
        let sauth = settlement_staker_authority(&s.addr);
        *w.stakes
            .iter()
            .find(|k| {
                stake_meta(&t.get_account(k))
                    .map(|m| m.authorized.staker == sauth)
                    .unwrap_or(false)
            })
            .unwrap()
    };
    let e = claim(&mut t, &mut w, &s, 0, stake_funded);
    assert!(e.ok, "{} {}", e.err, e.logs);
    // lamports_claimed > 0 now: adding a near-u64::MAX claim must not wrap or panic
    let mut s2 = s;
    s2.leaves[1].claim = u64::MAX;
    let l = s2.leaves[1].clone();
    let a = ClaimSettlementV2Args {
        proof: vec![],
        tree_node_hash: l.node_hash(),
        stake_account_staker: l.staker,
        stake_account_withdrawer: l.withdrawer,
        claim: u64::MAX,
        index: 1,
    };
    let ix = claim_settlement_v2(
        w.config,
        w.votes[0].bond,
        s2.addr,
        stake_funded,
        s2.dest[1],
        None,
        None,
        &a,
    );
    let e = w.exec(&mut t, "claim_settlement_v2", ix);
    assert_fails_with(&e, CLAIM_EXCEEDS_MAX);
}

#[test]
fn huge_epochs_to_claim_settlement_does_not_overflow() {
    let (mut t, mut w) = env();
    let stake = funded_stake(&mut t, &mut w, 10 * SOL);
    let s = settlement(&mut t, &mut w, &[SOL / 10], None);
    assert!(fund(&mut t, &mut w, &s, stake).ok);
    configure(
        &mut t,
        &mut w,
        ConfigureConfigArgs {
            epochs_to_claim_settlement: Some(u64::MAX),
            ..Default::default()
        },
    );
    next_epoch(&mut t);
    let sauth = settlement_staker_authority(&s.addr);
    let from = *w
        .stakes
        .iter()
        .find(|k| {
            stake_meta(&t.get_account(k))
                .map(|m| m.authorized.staker == sauth)
                .unwrap_or(false)
        })
        .unwrap();
    // never expires: the claim goes through and close is refused
    let e = claim(&mut t, &mut w, &s, 0, from);
    assert!(e.ok, "{} {}", e.err, e.logs);
    let v = w.votes[0].clone();
    let (rc, split_rc) = (w.admin, w.payer);
    let e = w.exec(
        &mut t,
        "close_settlement_v2",
        close_settlement_v2(w.config, v.bond, s.addr, rc, split_rc, rc),
    );
    assert_fails_with(&e, NOT_EXPIRED);
}

#[test]
fn huge_slots_to_start_claiming_does_not_overflow() {
    let (mut t, mut w) = env();
    let stake = funded_stake(&mut t, &mut w, 10 * SOL);
    let s = settlement(&mut t, &mut w, &[SOL / 10], None);
    assert!(fund(&mut t, &mut w, &s, stake).ok);
    configure(
        &mut t,
        &mut w,
        ConfigureConfigArgs {
            slots_to_start_settlement_claiming: Some(u64::MAX),
            ..Default::default()
        },
    );
    next_epoch(&mut t);
    let sauth = settlement_staker_authority(&s.addr);
    let from = *w
        .stakes
        .iter()
        .find(|k| {
            stake_meta(&t.get_account(k))
                .map(|m| m.authorized.staker == sauth)
                .unwrap_or(false)
        })
        .unwrap();
    let e = claim(&mut t, &mut w, &s, 0, from);
    assert_fails_with(&e, 6061); // SettlementNotReadyForClaiming
}

#[test]
fn huge_withdraw_lockup_does_not_overflow() {
    let (mut t, mut w) = env();
    let v = w.votes[0].clone();
    let auth = w.actors[2];
    let stake = funded_stake(&mut t, &mut w, 10 * SOL);
    assert!(
        w.exec(
            &mut t,
            "init_withdraw_request",
            init_withdraw_request(w.config, v.bond, v.vote, auth, w.payer, 3 * SOL)
        )
        .ok
    );
    configure(
        &mut t,
        &mut w,
        ConfigureConfigArgs {
            withdraw_lockup_epochs: Some(u64::MAX),
            ..Default::default()
        },
    );
    next_epoch(&mut t);
    let (split, dest) = (t.random_pubkey(), t.random_pubkey());
    let e = w.exec(
        &mut t,
        "claim_withdraw_request",
        claim_withdraw_request(w.config, v.bond, v.vote, auth, stake, dest, split, w.payer),
    );
    assert_fails_with(&e, WITHDRAW_NOT_READY);
}

/// Paused config blocks claims even with a valid proof.
#[test]
fn paused_blocks_claims() {
    let (mut t, mut w) = env();
    let stake = funded_stake(&mut t, &mut w, 10 * SOL);
    let s = settlement(&mut t, &mut w, &[SOL / 10], None);
    assert!(fund(&mut t, &mut w, &s, stake).ok);
    next_epoch(&mut t);
    let pause = w.admin;
    assert!(
        w.exec(&mut t, "emergency_pause", emergency_pause(w.config, pause))
            .ok
    );
    let sauth = settlement_staker_authority(&s.addr);
    let from = *w
        .stakes
        .iter()
        .find(|k| {
            stake_meta(&t.get_account(k))
                .map(|m| m.authorized.staker == sauth)
                .unwrap_or(false)
        })
        .unwrap();
    assert_fails_with(&claim(&mut t, &mut w, &s, 0, from), PAUSED_CODE);
}
