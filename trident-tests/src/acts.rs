//! Fuzz actions: each builds one (possibly invalid) instruction, runs it and checks the outcome
//! against an oracle derived from the on-chain state read before the transaction.

use solana_stake_interface::state::{Lockup, StakeStateV2};
use trident_fuzz::fuzzing::*;

use crate::ix::*;
use crate::merkle::{Leaf, Tree};
use crate::state::*;
use crate::world::*;

fn u128add(a: u64, b: u64) -> u128 {
    a as u128 + b as u128
}

/// Re-implementation of the on-chain proof verification.
pub fn verify_proof(proof: &[[u8; 32]], root: [u8; 32], leaf: &Leaf) -> bool {
    use sha2::{Digest, Sha256};
    let mut cur: [u8; 32] = Sha256::new()
        .chain_update([0u8])
        .chain_update(leaf.node_hash())
        .finalize()
        .into();
    for p in proof {
        let (l, r) = if cur <= *p { (cur, *p) } else { (*p, cur) };
        cur = Sha256::new()
            .chain_update([1u8])
            .chain_update(l)
            .chain_update(r)
            .finalize()
            .into();
    }
    cur == root
}

fn token_amount(acc: &AccountSharedData) -> u64 {
    acc.data()
        .get(64..72)
        .map(|b| u64::from_le_bytes(b.try_into().unwrap()))
        .unwrap_or(0)
}

fn rand_u64(t: &mut Trident) -> u64 {
    match t.random_from_range(0..8u32) {
        0 => 0,
        1 => u64::MAX,
        2 => 1,
        _ => t.random_from_range(0..20 * SOL),
    }
}

impl World {
    pub fn bonded(&self, t: &mut Trident) -> Vec<usize> {
        (0..self.votes.len())
            .filter(|i| self.bond_of(t, *i).is_some())
            .collect()
    }

    // ============================== config =====================================

    pub fn act_configure_config(&mut self, t: &mut Trident) {
        let cfg = self.cfg(t);
        let signer = self.signer(t, cfg.admin_authority);
        let mut a = ConfigureConfigArgs::default();
        if chance(t, 25) {
            a.admin = Some(pick(t, &self.actors));
        }
        if chance(t, 30) {
            a.operator = Some(pick(t, &self.actors));
        }
        if chance(t, 25) {
            a.pause_authority = Some(pick(t, &self.actors));
        }
        if chance(t, 40) {
            a.epochs_to_claim_settlement = Some(if chance(t, 4) {
                u64::MAX
            } else if chance(t, 8) {
                0
            } else {
                t.random_from_range(1..6)
            });
        }
        if chance(t, 30) {
            a.withdraw_lockup_epochs = Some(if chance(t, 4) {
                u64::MAX
            } else {
                t.random_from_range(0..4)
            });
        }
        if chance(t, 30) {
            let m = *[0, 1, SOL, SOL, 2 * SOL, 50 * SOL]
                .get(t.random_from_range(0..6usize))
                .unwrap();
            a.minimum_stake_lamports = Some(m);
        }
        if chance(t, 30) {
            a.slots_to_start_settlement_claiming =
                Some(*[0, 0, 10, 500].get(t.random_from_range(0..4usize)).unwrap());
        }
        if chance(t, 20) {
            a.min_bond_max_stake_wanted = Some(
                *[0, 0, SOL, 1000 * SOL]
                    .get(t.random_from_range(0..4usize))
                    .unwrap(),
            );
        }
        let e = self.exec(
            t,
            "configure_config",
            configure_config(self.config, signer, &a),
        );
        let authorized = signer == cfg.admin_authority;
        if e.ok != authorized {
            self.flag(
                "configure_config_auth",
                format!("signer admin={authorized} but ok={} ({:?})", e.ok, e.code),
            );
        }
        if e.ok {
            if a.minimum_stake_lamports
                .map(|m| m < cfg.minimum_stake_lamports)
                .unwrap_or(false)
            {
                self.min_lowered = true;
            }
            let c: Config = decode(&e.post.get(&self.config)).unwrap();
            let exp = |o: Option<u64>, old: u64| o.unwrap_or(old);
            if c.admin_authority != a.admin.unwrap_or(cfg.admin_authority)
                || c.operator_authority != a.operator.unwrap_or(cfg.operator_authority)
                || c.pause_authority != a.pause_authority.unwrap_or(cfg.pause_authority)
                || c.epochs_to_claim_settlement
                    != exp(a.epochs_to_claim_settlement, cfg.epochs_to_claim_settlement)
                || c.withdraw_lockup_epochs
                    != exp(a.withdraw_lockup_epochs, cfg.withdraw_lockup_epochs)
                || c.minimum_stake_lamports
                    != exp(a.minimum_stake_lamports, cfg.minimum_stake_lamports)
                || c.slots_to_start_settlement_claiming
                    != exp(
                        a.slots_to_start_settlement_claiming,
                        cfg.slots_to_start_settlement_claiming,
                    )
                || c.min_bond_max_stake_wanted
                    != exp(a.min_bond_max_stake_wanted, cfg.min_bond_max_stake_wanted)
                || c.paused != cfg.paused
            {
                self.flag(
                    "configure_config_state",
                    format!("config {c:?} does not match args {a:?}"),
                );
            }
        }
    }

    pub fn act_pause_resume(&mut self, t: &mut Trident) {
        let cfg = self.cfg(t);
        let signer = self.signer(t, cfg.pause_authority);
        let pause = if cfg.paused {
            chance(t, 25)
        } else {
            chance(t, 12)
        };
        let ix = if pause {
            emergency_pause(self.config, signer)
        } else {
            emergency_resume(self.config, signer)
        };
        let e = self.exec(
            t,
            if pause {
                "emergency_pause"
            } else {
                "emergency_resume"
            },
            ix,
        );
        let authorized = signer == cfg.pause_authority;
        let state_ok = pause != cfg.paused;
        if e.ok != (authorized && state_ok) {
            self.flag(
                "pause_resume",
                format!(
                    "pause={pause} was_paused={} authorized={authorized} -> ok={} ({:?})",
                    cfg.paused, e.ok, e.code
                ),
            );
        }
        if e.ok && self.cfg(t).paused != pause {
            self.flag("pause_resume_state", "paused flag not updated");
        }
    }

    pub fn act_reinit_config(&mut self, t: &mut Trident) {
        let args = InitConfigArgs {
            admin_authority: pick(t, &self.actors),
            operator_authority: pick(t, &self.actors),
            epochs_to_claim_settlement: 1,
            withdraw_lockup_epochs: 1,
            slots_to_start_settlement_claiming: 0,
        };
        let before = self.cfg(t);
        let e = self.exec(
            t,
            "init_config",
            init_config(self.config, self.payer, &args),
        );
        if e.ok {
            self.flag(
                "init_config_twice",
                "init_config succeeded on an existing config",
            );
        }
        let after = self.cfg(t);
        if format!("{before:?}") != format!("{after:?}") {
            self.flag("init_config_twice_state", "existing config modified");
        }
    }

    // ================================ bond =====================================

    /// Bond for a vote-program-owned account with zeroed data of an arbitrary length.
    pub fn act_init_bond_junk_vote(&mut self, t: &mut Trident) {
        let len = *[0usize, 1, 3, 4, 20, 35, 36, 37, 100, 3762]
            .get(t.random_from_range(0..10usize))
            .unwrap();
        let vote = t.random_pubkey();
        t.set_account_custom(&vote, &AccountSharedData::new(10 * SOL, len, &VOTE_PROGRAM));
        let bond = bond_address(&self.config, &vote);
        let signer = if chance(t, 50) {
            Some(pick(t, &self.actors))
        } else {
            None
        };
        let a = InitBondArgs {
            bond_authority: pick(t, &self.actors),
            cpmpe: 0,
            max_stake_wanted: 0,
        };
        let e = self.exec(
            t,
            "init_bond",
            init_bond(self.config, vote, signer, bond, self.payer, &a),
        );
        let paused = self.cfg(t).paused;
        // an all-zero vote state has the default pubkey as identity, which nobody can sign for
        if e.ok && (paused || len < 36 || signer.is_some()) {
            self.flag(
                "init_bond_junk_vote",
                format!(
                    "bond created for junk vote account (len {len}, signer {})",
                    signer.is_some()
                ),
            );
        }
    }

    pub fn act_init_bond(&mut self, t: &mut Trident) {
        if chance(t, 12) {
            return self.act_init_bond_junk_vote(t);
        }
        let vi = t.random_from_range(0..self.votes.len());
        let v = self.votes[vi].clone();
        let cfg = self.cfg(t);
        let existed = self.bond_of(t, vi).is_some();
        let permissioned = chance(t, 60);
        let signer = if permissioned {
            Some(if chance(t, 80) {
                v.identity
            } else {
                pick(t, &self.actors)
            })
        } else {
            None
        };
        let args = InitBondArgs {
            bond_authority: pick(t, &self.actors),
            cpmpe: rand_u64(t),
            max_stake_wanted: *[
                0,
                0,
                cfg.min_bond_max_stake_wanted,
                cfg.min_bond_max_stake_wanted.saturating_sub(1),
                3 * SOL,
            ]
            .get(t.random_from_range(0..5usize))
            .unwrap(),
        };
        let e = self.exec(
            t,
            "init_bond",
            init_bond(self.config, v.vote, signer, v.bond, self.payer, &args),
        );
        let identity_ok = signer.map(|s| s == v.identity).unwrap_or(true);
        let max_ok = !permissioned
            || args.max_stake_wanted == 0
            || args.max_stake_wanted >= cfg.min_bond_max_stake_wanted;
        let expected = !existed && !cfg.paused && identity_ok && max_ok;
        if e.ok != expected {
            self.flag(
                "init_bond_outcome",
                format!("existed={existed} paused={} identity_ok={identity_ok} max_ok={max_ok} -> ok={} ({:?}) bond acct pre: lamports={} owner={} len={} permissioned={permissioned} {}", cfg.paused, e.ok, e.code, e.pre.lamports(&v.bond), e.pre.get(&v.bond).owner(), e.pre.get(&v.bond).data().len(), e.logs),
            );
        }
        if e.ok {
            let b: Bond = decode(&e.post.get(&v.bond)).unwrap();
            let (auth, cpmpe, max) = if permissioned {
                (args.bond_authority, args.cpmpe, args.max_stake_wanted)
            } else {
                (v.identity, 0, 0)
            };
            if b.authority != auth
                || b.cpmpe != cpmpe
                || b.max_stake_wanted != max
                || b.vote_account != v.vote
                || b.config != self.config
            {
                self.flag("init_bond_state", format!("{b:?}"));
            }
        }
    }

    pub fn act_configure_bond(&mut self, t: &mut Trident) {
        let Some(vi) = self.pick_bonded(t) else {
            return;
        };
        let v = self.votes[vi].clone();
        let bond = self.bond_of(t, vi).unwrap();
        let cfg = self.cfg(t);
        let signer = match t.random_from_range(0..10u32) {
            0..=3 => bond.authority,
            4..=6 => v.identity,
            _ => pick(t, &self.actors),
        };
        let a = ConfigureBondArgs {
            bond_authority: if chance(t, 40) {
                Some(pick(t, &self.actors))
            } else {
                None
            },
            cpmpe: if chance(t, 50) {
                Some(rand_u64(t))
            } else {
                None
            },
            max_stake_wanted: if chance(t, 40) {
                Some(
                    *[0, SOL, 3 * SOL, cfg.min_bond_max_stake_wanted]
                        .get(t.random_from_range(0..4usize))
                        .unwrap(),
                )
            } else {
                None
            },
        };
        let e = self.exec(
            t,
            "configure_bond",
            configure_bond(self.config, v.bond, signer, v.vote, &a),
        );
        let authorized = signer == bond.authority || signer == v.identity;
        let max_after = a.max_stake_wanted.unwrap_or(bond.max_stake_wanted);
        let max_ok = max_after == 0 || max_after >= cfg.min_bond_max_stake_wanted;
        if e.ok != (authorized && !cfg.paused && max_ok) {
            self.flag(
                "configure_bond_outcome",
                format!(
                    "authorized={authorized} paused={} max_ok={max_ok} -> ok={} ({:?})",
                    cfg.paused, e.ok, e.code
                ),
            );
        }
        if e.ok {
            let b: Bond = decode(&e.post.get(&v.bond)).unwrap();
            if b.authority != a.bond_authority.unwrap_or(bond.authority)
                || b.cpmpe != a.cpmpe.unwrap_or(bond.cpmpe)
                || b.max_stake_wanted != max_after
            {
                self.flag("configure_bond_state", format!("{b:?} vs {a:?}"));
            }
        }
    }

    pub fn pick_bonded(&self, t: &mut Trident) -> Option<usize> {
        let b = self.bonded(t);
        if b.is_empty() {
            None
        } else {
            Some(pick(t, &b))
        }
    }

    pub fn act_mint_configure(&mut self, t: &mut Trident) {
        let Some(vi) = self.pick_bonded(t) else {
            return;
        };
        let v = self.votes[vi].clone();
        let cfg = self.cfg(t);
        if chance(t, 60) {
            let who = if chance(t, 80) {
                v.identity
            } else {
                pick(t, &self.actors)
            };
            let e = self.exec(
                t,
                "mint_bond",
                mint_bond(self.config, v.bond, who, v.vote, self.payer),
            );
            let expected = who == v.identity && !cfg.paused;
            if e.ok != expected {
                self.flag(
                    "mint_bond_outcome",
                    format!(
                        "identity_ok={} paused={} -> ok={} ({:?})",
                        who == v.identity,
                        cfg.paused,
                        e.ok,
                        e.code
                    ),
                );
            }
            if e.ok {
                let ta = e.post.get(&ata(&who, &bond_mint(&v.bond, &who)));
                if token_amount(&ta)
                    < e.pre
                        .get(&ata(&who, &bond_mint(&v.bond, &who)))
                        .data()
                        .get(64..72)
                        .map(|_| token_amount(&e.pre.get(&ata(&who, &bond_mint(&v.bond, &who)))))
                        .unwrap_or(0)
                        + 1
                {
                    self.flag("mint_bond_amount", "token not minted");
                }
            }
        } else {
            let bond = self.bond_of(t, vi).unwrap();
            let holder = if chance(t, 80) {
                v.identity
            } else {
                pick(t, &self.actors)
            };
            let mint = bond_mint(&v.bond, &v.identity);
            if token_amount(&t.get_account(&ata(&v.identity, &mint))) == 0 && chance(t, 80) {
                self.exec(
                    t,
                    "mint_bond",
                    mint_bond(self.config, v.bond, v.identity, v.vote, self.payer),
                );
            }
            let token_account = if chance(t, 85) {
                ata(&holder, &mint)
            } else {
                ata(&v.identity, &mint)
            };
            let a = ConfigureBondWithMintArgs {
                validator_identity: if chance(t, 85) {
                    v.identity
                } else {
                    pick(t, &self.actors)
                },
                bond_authority: if chance(t, 50) {
                    Some(pick(t, &self.actors))
                } else {
                    None
                },
                cpmpe: if chance(t, 50) {
                    Some(rand_u64(t))
                } else {
                    None
                },
                max_stake_wanted: if chance(t, 30) { Some(SOL) } else { None },
            };
            let before = t.get_account(&token_account);
            let e = self.exec(
                t,
                "configure_bond_with_mint",
                configure_bond_with_mint(
                    self.config,
                    v.bond,
                    v.vote,
                    mint,
                    token_account,
                    holder,
                    &a,
                ),
            );
            if e.ok {
                // success needs: identity matches the vote account, the signer owns a token of this bond's mint
                let owner_ok = before
                    .data()
                    .get(32..64)
                    .map(|o| o == holder.as_ref())
                    .unwrap_or(false);
                if a.validator_identity != v.identity
                    || !owner_ok
                    || token_amount(&before) == 0
                    || cfg.paused
                {
                    self.flag(
                        "configure_with_mint_auth",
                        format!(
                            "accepted: identity_ok={} owner_ok={owner_ok} amount={}",
                            a.validator_identity == v.identity,
                            token_amount(&before)
                        ),
                    );
                }
                if token_amount(&e.post.get(&token_account)) + 1 != token_amount(&before) {
                    self.flag("configure_with_mint_burn", "token not burned");
                }
                let b: Bond = decode(&e.post.get(&v.bond)).unwrap();
                if b.authority != a.bond_authority.unwrap_or(bond.authority)
                    || b.cpmpe != a.cpmpe.unwrap_or(bond.cpmpe)
                {
                    self.flag("configure_with_mint_state", format!("{b:?}"));
                }
            }
        }
    }

    pub fn act_bond_product(&mut self, t: &mut Trident) {
        let Some(vi) = self.pick_bonded(t) else {
            return;
        };
        let v = self.votes[vi].clone();
        let bond = self.bond_of(t, vi).unwrap();
        let cfg = self.cfg(t);
        let signer = match t.random_from_range(0..10u32) {
            0..=3 => bond.authority,
            4..=6 => v.identity,
            _ => pick(t, &self.actors),
        };
        let authorized = signer == bond.authority || signer == v.identity;
        let commission = |t: &mut Trident| {
            let one = |t: &mut Trident| {
                if chance(t, 60) {
                    Some(
                        *[0i64, 100, 10_000, 10_001, -5, i64::MAX]
                            .get(t.random_from_range(0..6usize))
                            .unwrap(),
                    )
                } else {
                    None
                }
            };
            ProductTypeConfig::Commission(CommissionProductConfig {
                inflation_bps: one(t),
                mev_bps: one(t),
                block_bps: one(t),
            })
        };
        if chance(t, 55) || self.products.is_empty() {
            let (pt, cd) = match t.random_from_range(0..10u32) {
                0..=5 => (ProductType::Commission, commission(t)),
                6 | 7 => {
                    // names above 32 bytes have no PDA and abort the program (known open issue, see README)
                    let long = std::env::var("FUZZ_LONG_PRODUCT_NAMES").is_ok();
                    let len = *[
                        1usize,
                        5,
                        31,
                        32,
                        if long { 33 } else { 16 },
                        if long { 60 } else { 8 },
                    ]
                    .get(t.random_from_range(0..6usize))
                    .unwrap();
                    (
                        ProductType::Custom(t.random_string(len)),
                        ProductTypeConfig::Custom(vec![1, 2, 3]),
                    )
                }
                _ => (ProductType::Commission, ProductTypeConfig::Custom(vec![9])),
            };
            let with_auth = chance(t, 75);
            let seed = pt.seed();
            let product = if seed.len() > 32 {
                t.random_pubkey()
            } else {
                bond_product_address(&v.bond, &seed)
            };
            let a = InitBondProductArgs {
                product_type: pt,
                config_data: cd,
            };
            let existed = self.products.iter().any(|(_, p)| *p == product);
            let e = self.exec(
                t,
                "init_bond_product",
                init_bond_product(
                    self.config,
                    v.bond,
                    v.vote,
                    product,
                    if with_auth { Some(signer) } else { None },
                    self.payer,
                    &a,
                ),
            );
            if e.ok {
                if cfg.paused || (with_auth && !authorized) || existed {
                    self.flag("init_bond_product_auth", format!("accepted: paused={} with_auth={with_auth} authorized={authorized} existed={existed}", cfg.paused));
                }
                self.products.push((vi, product));
            }
        } else {
            let (pvi, product) = pick(t, &self.products);
            let v = self.votes[pvi].clone();
            let bond = self.bond_of(t, pvi).unwrap();
            let signer = if chance(t, 70) {
                bond.authority
            } else {
                signer
            };
            let authorized = signer == bond.authority || signer == v.identity;
            let a = ConfigureBondProductArgs {
                config_data: commission(t),
            };
            let e = self.exec(
                t,
                "configure_bond_product",
                configure_bond_product(self.config, v.bond, v.vote, product, signer, &a),
            );
            if e.ok && (cfg.paused || !authorized) {
                self.flag(
                    "configure_bond_product_auth",
                    "unauthorized configure accepted",
                );
            }
        }
    }

    // ============================= fund bond ===================================

    /// Creates a stake account (random shape) and tries to fund it to the bond with a random signer.
    pub fn act_fund_bond(&mut self, t: &mut Trident) {
        let Some(vi) = self.pick_bonded(t) else {
            return;
        };
        let cfg = self.cfg(t);
        let owner = t.random_pubkey();
        let epoch = self.clock(t).epoch;
        let ts = self.clock(t).unix_timestamp;
        let target_vi = if chance(t, 85) {
            vi
        } else {
            t.random_from_range(0..self.votes.len())
        };
        let (vote, act) = match t.random_from_range(0..20u32) {
            0..=11 => (Some(self.votes[target_vi].vote), Activation::Active),
            12..=14 => (Some(self.votes[target_vi].vote), Activation::Activating),
            15 => (Some(self.votes[target_vi].vote), Activation::Deactivated),
            16 | 17 => (None, Activation::Active),
            _ => (Some(self.votes[target_vi].vote), Activation::Active),
        };
        let lockup = if chance(t, 8) {
            Lockup {
                unix_timestamp: ts + 1000,
                epoch: 0,
                custodian: pick(t, &self.actors),
            }
        } else {
            Lockup::default()
        };
        let delegated = *[SOL / 10, SOL, 2 * SOL, 5 * SOL, 20 * SOL, 100 * SOL]
            .get(t.random_from_range(0..6usize))
            .unwrap();
        let extra = if chance(t, 20) {
            t.random_from_range(0..SOL)
        } else {
            0
        };
        let acc = make_stake(vote, owner, owner, lockup, delegated, extra, act, epoch);
        let stake = self.new_stake(t, acc);
        let signer = if chance(t, 85) {
            owner
        } else {
            pick(t, &self.actors)
        };
        let bond_vote = self.votes[vi].vote;
        let e = self.exec(
            t,
            "fund_bond",
            fund_bond(self.config, self.votes[vi].bond, stake, signer),
        );
        let expected = !cfg.paused
            && signer == owner
            && !(lockup.unix_timestamp > ts)
            && vote == Some(bond_vote)
            && matches!(act, Activation::Active | Activation::Activating);
        if e.ok != expected {
            self.flag(
                "fund_bond_outcome",
                format!(
                    "expected_ok={expected} got ok={} ({:?}) vote_ok={} act={act:?} paused={}",
                    e.ok,
                    e.code,
                    vote == Some(bond_vote),
                    cfg.paused
                ),
            );
        }
        if e.ok {
            let m = stake_meta(&e.post.get(&stake)).unwrap();
            if m.authorized.staker != self.bonds_pda()
                || m.authorized.withdrawer != self.bonds_pda()
            {
                self.flag(
                    "fund_bond_authorities",
                    "stake not handed to the bonds authority",
                );
            }
            if e.post.lamports(&stake) != e.pre.lamports(&stake) {
                self.flag("fund_bond_lamports", "stake lamports changed");
            }
        }
    }

    pub fn funded_stakes(&self, t: &mut Trident, vi: usize) -> Vec<Pubkey> {
        let pda = self.bonds_pda();
        let vote = self.votes[vi].vote;
        self.stakes
            .iter()
            .copied()
            .filter(|k| {
                let a = t.get_account(k);
                a.lamports() > 0
                    && stake_meta(&a)
                        .map(|m| m.authorized.staker == pda && m.authorized.withdrawer == pda)
                        .unwrap_or(false)
                    && stake_delegation(&a)
                        .map(|d| d.voter_pubkey == vote)
                        .unwrap_or(false)
            })
            .collect()
    }

    /// Valid fund_bond of a fresh active stake; returns its address.
    pub fn ensure_funded_stake(
        &mut self,
        t: &mut Trident,
        vi: usize,
        delegated: u64,
    ) -> Option<Pubkey> {
        let owner = t.random_pubkey();
        let s = self.new_owned_stake(t, Some(vi), owner, delegated, Activation::Active);
        let e = self.exec(
            t,
            "fund_bond",
            fund_bond(self.config, self.votes[vi].bond, s, owner),
        );
        e.ok.then_some(s)
    }

    // ============================ withdraw request ==============================

    pub fn act_withdraw(&mut self, t: &mut Trident) {
        let Some(vi) = self.pick_bonded(t) else {
            return;
        };
        let v = self.votes[vi].clone();
        let bond = self.bond_of(t, vi).unwrap();
        let cfg = self.cfg(t);
        let clock = self.clock(t);
        let wr_addr = withdraw_request_address(&v.bond);
        let wr: Option<WithdrawRequest> = decode(&t.get_account(&wr_addr));
        let signer = match t.random_from_range(0..10u32) {
            0..=3 => bond.authority,
            4..=6 => v.identity,
            _ => pick(t, &self.actors),
        };
        let authorized = signer == bond.authority || signer == v.identity;
        let wr = if wr.is_none() && chance(t, 75) {
            let amount = *[SOL, 3 * SOL, 8 * SOL]
                .get(t.random_from_range(0..3usize))
                .unwrap();
            self.exec(
                t,
                "init_withdraw_request",
                init_withdraw_request(
                    self.config,
                    v.bond,
                    v.vote,
                    bond.authority,
                    self.payer,
                    amount,
                ),
            );
            decode(&t.get_account(&wr_addr))
        } else {
            wr
        };
        match t.random_from_range(0..10u32) {
            0..=1 => {
                let amount = *[0, SOL, 3 * SOL, 8 * SOL, 1000 * SOL, u64::MAX]
                    .get(t.random_from_range(0..6usize))
                    .unwrap();
                let e = self.exec(
                    t,
                    "init_withdraw_request",
                    init_withdraw_request(self.config, v.bond, v.vote, signer, self.payer, amount),
                );
                let expected = wr.is_none() && authorized && !cfg.paused;
                if e.ok != expected {
                    self.flag(
                        "init_withdraw_outcome",
                        format!(
                            "existing={} authorized={authorized} paused={} -> ok={} ({:?})",
                            wr.is_some(),
                            cfg.paused,
                            e.ok,
                            e.code
                        ),
                    );
                }
            }
            3 => {
                let collector = pick(t, &self.actors);
                let e = self.exec(
                    t,
                    "cancel_withdraw_request",
                    cancel_withdraw_request(self.config, v.bond, v.vote, signer, collector),
                );
                let expected = wr.is_some() && authorized && !cfg.paused;
                if e.ok != expected {
                    self.flag(
                        "cancel_withdraw_outcome",
                        format!(
                            "existing={} authorized={authorized} paused={} -> ok={} ({:?}) {} {}",
                            wr.is_some(),
                            cfg.paused,
                            e.ok,
                            e.code,
                            e.err,
                            format!("collector={collector} lamports={} owner={} len={} signer={signer} wr_lamports={}", e.pre.lamports(&collector), e.pre.get(&collector).owner(), e.pre.get(&collector).data().len(), e.pre.lamports(&wr_addr))
                        ),
                    );
                }
                if e.ok && e.post.lamports(&wr_addr) != 0 {
                    self.flag("cancel_withdraw_close", "request not closed");
                }
            }
            _ => {
                // claim
                if let Some(w) = wr.as_ref() {
                    if u128add(w.epoch, cfg.withdraw_lockup_epochs) >= clock.epoch as u128
                        && w.epoch as u128 + (cfg.withdraw_lockup_epochs as u128) < 1000
                        && chance(t, 60)
                    {
                        t.warp_to_epoch(w.epoch + cfg.withdraw_lockup_epochs + 1);
                    }
                }
                let clock = self.clock(t);
                let mut candidates = self.funded_stakes(t, vi);
                if candidates.is_empty() || chance(t, 15) {
                    let size = *[SOL, 3 * SOL, 6 * SOL, 12 * SOL]
                        .get(t.random_from_range(0..4usize))
                        .unwrap();
                    if let Some(s) = self.ensure_funded_stake(t, vi, size) {
                        candidates.push(s);
                    }
                }
                let stake = if candidates.is_empty() || chance(t, 12) {
                    pick(t, &self.stakes)
                } else {
                    pick(t, &candidates)
                };
                let dest = pick(t, &self.actors);
                let split = t.random_pubkey();
                let pre_stake = t.get_account(&stake);
                let e = self.exec(
                    t,
                    "claim_withdraw_request",
                    claim_withdraw_request(
                        self.config,
                        v.bond,
                        v.vote,
                        signer,
                        stake,
                        dest,
                        split,
                        self.payer,
                    ),
                );
                if e.ok {
                    let wr = wr.as_ref().expect("claim without request succeeded");
                    let m = stake_meta(&pre_stake).unwrap();
                    let pda = self.bonds_pda();
                    let lockup_ok =
                        u128add(wr.epoch, cfg.withdraw_lockup_epochs) < clock.epoch as u128;
                    if !authorized
                        || cfg.paused
                        || !lockup_ok
                        || m.authorized.staker != pda
                        || m.authorized.withdrawer != pda
                        || wr.requested_amount <= wr.withdrawn_amount
                    {
                        self.flag(
                            "claim_withdraw_precondition",
                            format!("accepted: authorized={authorized} lockup_ok={lockup_ok} staker_pda={} withdrawer_pda={} req={} withdrawn={}", m.authorized.staker == pda, m.authorized.withdrawer == pda, wr.requested_amount, wr.withdrawn_amount),
                        );
                    }
                    if stake_delegation(&pre_stake).map(|d| d.voter_pubkey) != Some(v.vote) {
                        self.flag(
                            "claim_withdraw_wrong_vote",
                            "stake not delegated to the bond's vote account was released",
                        );
                    }
                    let wr_post: WithdrawRequest = decode(&e.post.get(&wr_addr)).unwrap();
                    let moved = wr_post.withdrawn_amount - wr.withdrawn_amount;
                    if wr_post.withdrawn_amount > wr_post.requested_amount {
                        self.flag(
                            "withdraw_over_requested",
                            format!(
                                "withdrawn {} > requested {}",
                                wr_post.withdrawn_amount, wr_post.requested_amount
                            ),
                        );
                    }
                    let post_meta = stake_meta(&e.post.get(&stake)).unwrap();
                    if post_meta.authorized.staker != dest
                        || post_meta.authorized.withdrawer != dest
                    {
                        self.flag(
                            "claim_withdraw_authorities",
                            "released stake not handed to requested withdrawer",
                        );
                    }
                    if e.post.lamports(&stake) != moved {
                        self.flag(
                            "withdraw_amount_mismatch",
                            format!(
                                "released stake holds {} but withdrawn_amount grew by {moved}",
                                e.post.lamports(&stake)
                            ),
                        );
                    }
                    let split_post = t.get_account(&split);
                    if split_post.lamports() > 0 {
                        let sm = stake_meta(&split_post);
                        if sm.map(|m| m.authorized.withdrawer != pda).unwrap_or(true) {
                            self.flag(
                                "withdraw_leftover_authority",
                                "leftover split stake not kept by the bonds authority",
                            );
                        }
                        self.stakes.push(split);
                    }
                    let split_rent_paid = e
                        .pre
                        .lamports(&self.payer)
                        .saturating_sub(e.post.lamports(&self.payer));
                    if split_post.lamports() > 0
                        && e.post.lamports(&stake) as u128 + split_post.lamports() as u128
                            != e.pre.lamports(&stake) as u128 + split_rent_paid as u128
                    {
                        self.flag("withdraw_split_sum", "stake + leftover != original");
                    }
                }
            }
        }
    }

    // ============================= settlements ==================================

    pub fn act_init_settlement(&mut self, t: &mut Trident, force_valid: bool) -> Option<usize> {
        let vi = self.pick_bonded(t)?;
        let v = self.votes[vi].clone();
        let cfg = self.cfg(t);
        let clock = self.clock(t);
        let n = t.random_from_range(1..=6usize);
        let mut leaves = vec![];
        let mut dest = vec![];
        for i in 0..n {
            let msol = chance(t, 30);
            let withdrawer = if msol {
                MARINADE_WITHDRAW_AUTH
            } else {
                t.random_pubkey()
            };
            let staker = t.random_pubkey();
            let claim = t.random_from_range(1_000..=SOL / 2 + 7);
            leaves.push(Leaf {
                staker,
                withdrawer,
                claim,
                index: i as u64,
            });
            let addr = if msol && chance(t, 60) && !self.msol_members.is_empty() {
                pick(t, &self.msol_members)
            } else {
                t.random_pubkey()
            };
            let lockup = if chance(t, 5) {
                Lockup {
                    unix_timestamp: clock.unix_timestamp + 500,
                    epoch: 0,
                    custodian: Pubkey::default(),
                }
            } else {
                Lockup::default()
            };
            let acc = make_stake(
                None,
                staker,
                withdrawer,
                lockup,
                0,
                0,
                Activation::Active,
                clock.epoch,
            );
            t.set_account_custom(&addr, &acc);
            dest.push(addr);
        }
        let tree = Tree::new(&leaves);
        let total: u64 = leaves.iter().map(|l| l.claim).sum();
        let (max_total, max_nodes) = if force_valid {
            (total, n as u64)
        } else {
            (
                match t.random_from_range(0..12u32) {
                    0 => total / 2,
                    1 => 0,
                    2 => total + 1 + t.random_from_range(0..SOL),
                    3 => u64::MAX - t.random_from_range(0..3u64),
                    _ => total,
                },
                match t.random_from_range(0..12u32) {
                    0 => (n as u64).saturating_sub(1),
                    1 => 0,
                    2 => n as u64 + t.random_from_range(0..70),
                    3 => 82_000 + t.random_from_range(0..200_000), // claims account larger than one allocation
                    _ => n as u64,
                },
            )
        };
        let epoch = if force_valid || chance(t, 85) {
            clock.epoch
        } else {
            t.random_from_range(0..clock.epoch + 3)
        };
        let args = InitSettlementArgs {
            merkle_root: tree.root(),
            max_total_claim: max_total,
            max_merkle_nodes: max_nodes,
            rent_collector: pick(t, &self.actors),
            epoch,
        };
        let signer = if force_valid {
            cfg.operator_authority
        } else {
            self.signer(t, cfg.operator_authority)
        };
        let addr = settlement_address(&v.bond, &args.merkle_root, epoch);
        for d in &dest {
            // destinations are tracked for snapshots (they are not in `stakes` to keep stake invariants focused)
            let _ = d;
        }
        let e = self.exec(
            t,
            "init_settlement",
            init_settlement(self.config, v.bond, signer, self.payer, &args),
        );
        let expected =
            signer == cfg.operator_authority && !cfg.paused && max_total > 0 && max_nodes > 0;
        if e.ok != expected {
            self.flag("init_settlement_outcome", format!("operator_ok={} paused={} max_total={max_total} max_nodes={max_nodes} -> ok={} ({:?}) payer={} {} {}", signer == cfg.operator_authority, cfg.paused, e.ok, e.code, e.pre.lamports(&self.payer), e.err, e.logs));
        }
        if !e.ok {
            return None;
        }
        let st: Settlement = decode(&e.post.get(&addr)).unwrap();
        if st.bond != v.bond
            || st.merkle_root != args.merkle_root
            || st.max_total_claim != max_total
            || st.max_merkle_nodes != max_nodes
            || st.lamports_funded != 0
            || st.lamports_claimed != 0
            || st.merkle_nodes_claimed != 0
            || st.epoch_created_for != epoch
            || st.rent_collector != args.rent_collector
            || st.split_rent_collector.is_some()
            || st.staker_authority != settlement_staker_authority(&addr)
        {
            self.flag("init_settlement_state", format!("{st:?}"));
        }
        let claims = e.post.get(&settlement_claims_address(&addr));
        let full = 56 + max_nodes.div_ceil(8) as usize;
        if claims.data().len() > full || claims.data().len() > 10240 {
            self.flag(
                "claims_account_size",
                format!("claims account {} > {full}", claims.data().len()),
            );
        }
        self.settlements.push(Stl {
            addr,
            vote_idx: vi,
            leaves,
            dest,
            tree,
            claimed: Default::default(),
            claimed_lamports: 0,
        });
        Some(self.settlements.len() - 1)
    }

    pub fn live_settlements(&self, t: &mut Trident) -> Vec<usize> {
        (0..self.settlements.len())
            .filter(|i| self.settlement_state(t, *i).is_some())
            .collect()
    }

    pub fn act_fund_settlement(&mut self, t: &mut Trident, target: Option<usize>) {
        let live = self.live_settlements(t);
        let si = if let Some(i) = target {
            i
        } else if live.is_empty() || chance(t, 10) {
            match self.act_init_settlement(t, true) {
                Some(i) => i,
                None => return,
            }
        } else {
            pick(t, &live)
        };
        let Some(st) = self.settlement_state(t, si) else {
            return;
        };
        let vi = self.settlements[si].vote_idx;
        let v = self.votes[vi].clone();
        let cfg = self.cfg(t);
        let mut stakes = self.funded_stakes(t, vi);
        if stakes.is_empty() || chance(t, 20) {
            let size = *[SOL / 2, 2 * SOL, 3 * SOL, 6 * SOL, 15 * SOL, 40 * SOL]
                .get(t.random_from_range(0..6usize))
                .unwrap();
            if let Some(s) = self.ensure_funded_stake(t, vi, size) {
                stakes.push(s);
            }
        }
        if stakes.is_empty() && self.stakes.is_empty() {
            return;
        }
        let stake = if stakes.is_empty() || chance(t, 10) {
            pick(t, &self.stakes)
        } else {
            pick(t, &stakes)
        };
        let signer = self.signer(t, cfg.operator_authority);
        let split = t.random_pubkey();
        let pre_stake = t.get_account(&stake);
        let e = self.exec(
            t,
            "fund_settlement",
            fund_settlement(
                self.config,
                v.bond,
                v.vote,
                self.settlements[si].addr,
                signer,
                stake,
                split,
                self.payer,
            ),
        );
        if !e.ok {
            return;
        }
        if std::env::var("FUZZ_TRACE").is_ok() {
            let stp: Settlement = decode(&e.post.get(&self.settlements[si].addr)).unwrap();
            eprintln!("  fund_settlement S{si} stake={stake} funded {} -> {} (max {}) pre_stake_lamports={} post={}", st.lamports_funded, stp.lamports_funded, st.max_total_claim, e.pre.lamports(&stake), e.post.lamports(&stake));
        }
        let pda = self.bonds_pda();
        let st_post: Settlement = decode(&e.post.get(&self.settlements[si].addr)).unwrap();
        if signer != cfg.operator_authority {
            self.flag("fund_settlement_auth", "non-operator funded a settlement");
        }
        if st.lamports_funded >= st.max_total_claim {
            return; // already fully funded: no-op
        }
        let m = stake_meta(&pre_stake).unwrap();
        if m.authorized.withdrawer != pda
            || m.authorized.staker != pda
            || stake_delegation(&pre_stake).map(|d| d.voter_pubkey) != Some(v.vote)
        {
            self.flag(
                "fund_settlement_stake",
                "stake not owned by the bond was funded to the settlement",
            );
        }
        let funding = st_post.lamports_funded - st.lamports_funded;
        let post_meta = stake_meta(&e.post.get(&stake)).unwrap();
        if post_meta.authorized.staker != st.staker_authority
            || post_meta.authorized.withdrawer != pda
        {
            self.flag(
                "fund_settlement_authorities",
                "funded stake has unexpected authorities",
            );
        }
        let min = m.rent_exempt_reserve + cfg.minimum_stake_lamports;
        if (e.post.lamports(&stake) as u128) < funding as u128 + min as u128 {
            self.flag(
                "fund_settlement_backing",
                format!(
                    "funded {funding} but stake holds only {} (min {min})",
                    e.post.lamports(&stake)
                ),
            );
        }
        if st_post.split_rent_collector.is_some() {
            let sp = t.get_account(&split);
            if sp.lamports() > 0 {
                self.stakes.push(split);
            }
        }
        // a funded-but-unclaimed amount must stay backed by stake owned by the settlement
        self.stakes.push(split);
    }

    #[allow(clippy::too_many_lines)]
    pub fn act_claim(&mut self, t: &mut Trident) {
        let live = self.live_settlements(t);
        let all: Vec<usize> = (0..self.settlements.len()).collect();
        let fresh: Vec<usize> = live
            .iter()
            .copied()
            .filter(|i| {
                let st = self.settlement_state(t, *i).unwrap();
                let cfg = self.cfg(t);
                st.epoch_created_for as u128 + cfg.epochs_to_claim_settlement as u128
                    >= self.clock(t).epoch as u128
            })
            .collect();
        let si = if live.is_empty() {
            return;
        } else if !fresh.is_empty() && chance(t, 85) {
            pick(t, &fresh)
        } else if chance(t, 80) {
            pick(t, &live)
        } else {
            pick(t, &all)
        };
        let addr = self.settlements[si].addr;
        let sauth0 = settlement_staker_authority(&addr);
        let has_funded = |w: &World, t: &mut Trident| {
            w.stakes.iter().any(|k| {
                t.get_account(k).lamports() > 0
                    && stake_meta(&t.get_account(k))
                        .map(|m| m.authorized.staker == sauth0)
                        .unwrap_or(false)
            })
        };
        if self.settlement_state(t, si).is_some() && !has_funded(self, t) && chance(t, 70) {
            self.act_fund_settlement(t, Some(si));
        }
        let c = self.clock(t);
        let needs_epoch = self.stakes.iter().any(|k| {
            let a = t.get_account(k);
            a.lamports() > 0
                && stake_meta(&a)
                    .map(|m| m.authorized.staker == sauth0)
                    .unwrap_or(false)
                && stake_delegation(&a)
                    .map(|d| d.deactivation_epoch >= c.epoch)
                    .unwrap_or(false)
        });
        if needs_epoch && chance(t, 70) {
            // funded stake needs one epoch to deactivate before it can be claimed from
            t.warp_to_epoch(c.epoch + 1);
            t.warp_to_slot(c.slot + 1000);
        }
        let cfg = self.cfg(t);
        let clock = self.clock(t);
        let vi = self.settlements[si].vote_idx;
        let v = self.votes[vi].clone();
        let st = self.settlement_state(t, si);
        let unclaimed: Vec<usize> = (0..self.settlements[si].leaves.len())
            .filter(|i| !self.settlements[si].claimed.contains(&(*i as u64)))
            .collect();
        let li = if !unclaimed.is_empty() && chance(t, 80) {
            pick(t, &unclaimed)
        } else {
            t.random_from_range(0..self.settlements[si].leaves.len())
        };
        let leaf = self.settlements[si].leaves[li].clone();
        let mut proof = self.settlements[si].tree.proof(li);
        let mut args_leaf = leaf.clone();
        let mut hash = leaf.node_hash();
        let mut stake_to = self.settlements[si].dest[li];
        let sauth = settlement_staker_authority(&addr);
        let mut stake_from = {
            let from: Vec<Pubkey> = self
                .stakes
                .iter()
                .copied()
                .filter(|k| {
                    stake_meta(&t.get_account(k))
                        .map(|m| {
                            m.authorized.staker == sauth
                                && m.authorized.withdrawer == self.bonds_pda()
                        })
                        .unwrap_or(false)
                        && t.get_account(k).lamports() > 0
                })
                .collect();
            if from.is_empty() {
                pick(t, &self.stakes)
            } else {
                pick(t, &from)
            }
        };
        let variant = match t.random_from_range(0..20u32) {
            0..=9 => "valid",
            10 => "proof_flip",
            11 => "proof_drop",
            12 => "claim_changed",
            13 => "hash_stale",
            14 => "other_index",
            15 => "swap_authorities",
            16 => "wrong_dest",
            17 => "wrong_from",
            18 => "same_from_to",
            _ => "other_leaf_proof",
        };
        match variant {
            "proof_flip" if !proof.is_empty() => {
                let i = t.random_from_range(0..proof.len());
                proof[i][t.random_from_range(0..32usize)] ^= 1 << t.random_from_range(0..8u32);
            }
            "proof_drop" if !proof.is_empty() => {
                proof.pop();
            }
            "claim_changed" => {
                args_leaf.claim = if chance(t, 50) {
                    leaf.claim.saturating_add(1 + t.random_from_range(0..1000))
                } else {
                    leaf.claim.saturating_sub(1).max(1)
                };
                if chance(t, 10) {
                    args_leaf.claim = u64::MAX;
                }
                hash = args_leaf.node_hash();
            }
            "hash_stale" => {
                args_leaf.claim = leaf.claim.saturating_add(7);
            }
            "other_index" => {
                args_leaf.index = leaf.index + 1 + t.random_from_range(0..3);
                hash = args_leaf.node_hash();
            }
            "swap_authorities" => {
                std::mem::swap(&mut args_leaf.staker, &mut args_leaf.withdrawer);
                hash = args_leaf.node_hash();
            }
            "wrong_dest" => stake_to = pick(t, &self.stakes),
            "wrong_from" => stake_from = pick(t, &self.stakes),
            "same_from_to" => stake_to = stake_from,
            "other_leaf_proof" => {
                let o = t.random_from_range(0..self.settlements[si].leaves.len());
                proof = self.settlements[si].tree.proof(o);
            }
            _ => {}
        }
        // Marinade liquid accounts: right, missing or substituted
        let (mut ls, mut ll) = (Some(MARINADE_LIQUID_STATE), Some(MARINADE_STAKE_LIST));
        if leaf.withdrawer == MARINADE_WITHDRAW_AUTH || chance(t, 10) {
            match t.random_from_range(0..10u32) {
                0 => ls = None,
                1 => ll = None,
                2 => {
                    ls = None;
                    ll = None;
                }
                3 => {
                    // list copy owned by someone else that contains the destination
                    let fake = t.random_pubkey();
                    let mut acc = t.get_account(&MARINADE_STAKE_LIST);
                    acc.set_owner(if chance(t, 50) { SYSTEM } else { PROGRAM_ID });
                    t.set_account_custom(&fake, &acc);
                    ll = Some(fake);
                }
                4 => {
                    let fake = t.random_pubkey();
                    let mut acc = t.get_account(&MARINADE_LIQUID_STATE);
                    acc.set_owner(PROGRAM_ID);
                    t.set_account_custom(&fake, &acc);
                    ls = Some(fake);
                }
                _ => {}
            }
        }
        let a = ClaimSettlementV2Args {
            proof: proof.clone(),
            tree_node_hash: hash,
            stake_account_staker: args_leaf.staker,
            stake_account_withdrawer: args_leaf.withdrawer,
            claim: args_leaf.claim,
            index: args_leaf.index,
        };
        let pre_to = t.get_account(&stake_to);
        let pre_from = t.get_account(&stake_from);
        let to_state = Self::stake_state_str(&pre_to);
        let e = self.exec(
            t,
            "claim_settlement_v2",
            claim_settlement_v2(self.config, v.bond, addr, stake_from, stake_to, ls, ll, &a),
        );

        // ---- success oracle
        if e.ok {
            let model_leaf = self.settlements[si].leaves.get(a.index as usize);
            let is_real_leaf = model_leaf
                .map(|l| {
                    l.staker == a.stake_account_staker
                        && l.withdrawer == a.stake_account_withdrawer
                        && l.claim == a.claim
                })
                .unwrap_or(false);
            if !is_real_leaf {
                self.flag(
                    "claim_non_leaf_accepted",
                    format!("variant={variant}: claim of data that is not a leaf of the tree"),
                );
            }
            let root = st.as_ref().unwrap().merkle_root;
            if !verify_proof(&a.proof, root, &args_leaf) {
                self.flag("claim_invalid_proof_accepted", format!("variant={variant}"));
            }
            if self.settlements[si].claimed.contains(&a.index) {
                self.flag("double_claim", format!("leaf {} claimed twice", a.index));
            }
            if a.stake_account_withdrawer == MARINADE_WITHDRAW_AUTH
                && !self.msol_members.contains(&stake_to)
            {
                // `msol_members` holds the first 24 list entries; check the full list
                let state = t.get_account(&MARINADE_LIQUID_STATE);
                let list = t.get_account(&MARINADE_STAKE_LIST);
                if !stake_list_members(&state, &list).contains(&stake_to)
                    || ls != Some(MARINADE_LIQUID_STATE)
                    || ll != Some(MARINADE_STAKE_LIST)
                {
                    self.flag("claim_msol_unlisted_destination", format!("variant={variant}: mSOL leaf paid into a stake account outside the liquid stake list"));
                }
            }
            if a.stake_account_withdrawer == MARINADE_WITHDRAW_AUTH
                && (ls != Some(MARINADE_LIQUID_STATE) || ll != Some(MARINADE_STAKE_LIST))
            {
                self.flag(
                    "claim_msol_accounts_substituted",
                    "mSOL claim accepted with missing/substituted liquid accounts",
                );
            }
            let (fp, fq, tp, tq) = (
                e.pre.lamports(&stake_from),
                e.post.lamports(&stake_from),
                e.pre.lamports(&stake_to),
                e.post.lamports(&stake_to),
            );
            if fp - fq != a.claim || tq - tp != a.claim {
                self.flag(
                    "claim_amount_moved",
                    format!("from -{} to +{} but claim {}", fp - fq, tq - tp, a.claim),
                );
            }
            let to_meta = stake_meta(&pre_to);
            if to_meta
                .map(|m| {
                    m.authorized.withdrawer != a.stake_account_withdrawer
                        || m.authorized.staker != a.stake_account_staker
                })
                .unwrap_or(true)
            {
                self.flag(
                    "claim_destination_authorities",
                    format!("destination {to_state} does not match leaf authorities"),
                );
            }
            let from_meta = stake_meta(&pre_from).unwrap();
            if from_meta.authorized.staker != sauth
                || from_meta.authorized.withdrawer != self.bonds_pda()
            {
                self.flag(
                    "claim_wrong_source",
                    "paid from a stake not funded to this settlement",
                );
            }
            if stake_from == stake_to {
                self.flag("claim_same_account", "source == destination");
            }
            let st_post: Settlement = decode(&e.post.get(&addr)).unwrap();
            let st_pre = st.as_ref().unwrap();
            if st_post.lamports_claimed != st_pre.lamports_claimed + a.claim
                || st_post.merkle_nodes_claimed != st_pre.merkle_nodes_claimed + 1
            {
                self.flag(
                    "claim_counters",
                    "counters not advanced by exactly one claim",
                );
            }
            if (st_pre.epoch_created_for as u128 + cfg.epochs_to_claim_settlement as u128)
                < clock.epoch as u128
            {
                self.flag("claim_after_expiry", "claim accepted after expiry");
            }
            if (st_pre.slot_created_at as u128 + cfg.slots_to_start_settlement_claiming as u128)
                > clock.slot as u128
            {
                self.flag(
                    "claim_before_start",
                    "claim accepted before the claiming start slot",
                );
            }
            if std::env::var("FUZZ_TRACE").is_ok() {
                eprintln!(
                    "  claim S{si} leaf {} claim {} from {stake_from} (pre {}) funded {}",
                    a.index,
                    a.claim,
                    pre_from.lamports(),
                    st_pre.lamports_funded
                );
            }
            let s = &mut self.settlements[si];
            s.claimed.insert(a.index);
            s.claimed_lamports += a.claim;
        } else if variant == "valid" && ls.is_some() && ll.is_some() {
            // liveness: a fully valid claim must not be rejected
            if let Some(st) = st
                .as_ref()
                .filter(|_| ls == Some(MARINADE_LIQUID_STATE) && ll == Some(MARINADE_STAKE_LIST))
            {
                let min = self.stake_min_size(&e, &stake_from);
                let deactivated = stake_delegation(&pre_from)
                    .map(|d| d.deactivation_epoch < clock.epoch)
                    .unwrap_or(true);
                let from_ok = deactivated
                    && stake_meta(&pre_from)
                        .map(|m| {
                            m.authorized.staker == sauth
                                && m.authorized.withdrawer == self.bonds_pda()
                        })
                        .unwrap_or(false)
                    && (pre_from.lamports() as u128 >= leaf.claim as u128 + min as u128
                        || pre_from.lamports() == leaf.claim);
                let to_ok = stake_meta(&pre_to)
                    .map(|m| {
                        m.authorized.staker == leaf.staker
                            && m.authorized.withdrawer == leaf.withdrawer
                            && !(m.lockup.unix_timestamp > clock.unix_timestamp)
                    })
                    .unwrap_or(false);
                let list_ok = leaf.withdrawer != MARINADE_WITHDRAW_AUTH || {
                    let state = t.get_account(&MARINADE_LIQUID_STATE);
                    let list = t.get_account(&MARINADE_STAKE_LIST);
                    stake_list_members(&state, &list).contains(&stake_to)
                };
                let claims_len = e.pre.get(&settlement_claims_address(&addr)).data().len();
                let sized = claims_len >= 56 + st.max_merkle_nodes.div_ceil(8) as usize;
                let expected = !cfg.paused
                    && from_ok
                    && to_ok
                    && list_ok
                    && sized
                    && (st.epoch_created_for as u128 + cfg.epochs_to_claim_settlement as u128)
                        >= clock.epoch as u128
                    && (st.slot_created_at as u128
                        + cfg.slots_to_start_settlement_claiming as u128)
                        <= clock.slot as u128
                    && !self.settlements[si].claimed.contains(&leaf.index)
                    && leaf.index < st.max_merkle_nodes
                    && st.lamports_claimed as u128 + leaf.claim as u128
                        <= st.max_total_claim as u128
                    && st.merkle_nodes_claimed < st.max_merkle_nodes
                    && stake_from != stake_to;
                if expected {
                    self.flag("valid_claim_rejected", format!("{} {}", e.err, e.logs));
                }
            }
        }
        self.check_claim_model(t, si);
    }

    /// Random settlement, preferring closed ones when `prefer_closed`.
    pub fn pick_settlement(&self, t: &mut Trident, prefer_closed: bool) -> Option<usize> {
        if self.settlements.is_empty() {
            return None;
        }
        if prefer_closed && chance(t, 75) {
            let closed: Vec<usize> = (0..self.settlements.len())
                .filter(|i| self.settlement_state(t, *i).is_none())
                .collect();
            if !closed.is_empty() {
                return Some(pick(t, &closed));
            }
        }
        Some(t.random_from_range(0..self.settlements.len()))
    }

    pub fn act_upsize(&mut self, t: &mut Trident) {
        let live = self.live_settlements(t);
        if live.is_empty() {
            return;
        }
        let si = pick(t, &live);
        let claims = settlement_claims_address(&self.settlements[si].addr);
        let before = t.get_account(&claims).data().len();
        let e = self.exec(
            t,
            "upsize_settlement_claims",
            upsize_settlement_claims(claims, self.payer),
        );
        let after = e.post.get(&claims).data().len();
        let st = self.settlement_state(t, si).unwrap();
        let full = 56 + st.max_merkle_nodes.div_ceil(8) as usize;
        if after > full || (e.ok && after < before) || (!e.ok && after != before) {
            self.flag(
                "upsize_size",
                format!("size {before} -> {after} (full {full})"),
            );
        }
        if e.ok && before >= full {
            self.flag(
                "upsize_when_full",
                "upsize succeeded on a fully sized account",
            );
        }
    }

    pub fn act_close_cancel(&mut self, t: &mut Trident) {
        let live = self.live_settlements(t);
        if live.is_empty() {
            return;
        }
        let si = pick(t, &live);
        let cfg = self.cfg(t);
        let clock = self.clock(t);
        let st = self.settlement_state(t, si).unwrap();
        let vi = self.settlements[si].vote_idx;
        let v = self.votes[vi].clone();
        let addr = self.settlements[si].addr;
        let sauth = settlement_staker_authority(&addr);
        let rent_collector = if chance(t, 85) {
            st.rent_collector
        } else {
            pick(t, &self.actors)
        };
        let split_collector = match st.split_rent_collector {
            Some(k) if chance(t, 85) => k,
            _ => pick(t, &self.actors),
        };
        let refund = {
            let c: Vec<Pubkey> = self
                .stakes
                .iter()
                .copied()
                .filter(|k| {
                    stake_meta(&t.get_account(k))
                        .map(|m| m.authorized.staker == sauth)
                        .unwrap_or(false)
                        && t.get_account(k).lamports() > 0
                })
                .collect();
            if c.is_empty() || chance(t, 10) {
                pick(t, &self.stakes)
            } else {
                pick(t, &c)
            }
        };
        let cancel = chance(t, 40);
        let signer = match t.random_from_range(0..3u32) {
            0 => cfg.operator_authority,
            1 => cfg.pause_authority,
            _ => pick(t, &self.actors),
        };
        let claims = settlement_claims_address(&addr);
        let rc_pre = t.get_account(&rent_collector).lamports();
        let (name, ix) = if cancel {
            (
                "cancel_settlement",
                cancel_settlement(
                    self.config,
                    v.bond,
                    addr,
                    signer,
                    rent_collector,
                    split_collector,
                    refund,
                ),
            )
        } else {
            (
                "close_settlement_v2",
                close_settlement_v2(
                    self.config,
                    v.bond,
                    addr,
                    rent_collector,
                    split_collector,
                    refund,
                ),
            )
        };
        let e = self.exec(t, name, ix);
        if !e.ok {
            return;
        }
        let rent_ok = rent_collector == st.rent_collector;
        let split_ok = st
            .split_rent_collector
            .map(|k| k == split_collector)
            .unwrap_or(true);
        if !rent_ok || !split_ok || cfg.paused {
            self.flag("close_cancel_collectors", format!("{name}: accepted with wrong rent collector (rent_ok={rent_ok} split_ok={split_ok})"));
        }
        if cancel {
            if signer != cfg.operator_authority && signer != cfg.pause_authority {
                self.flag(
                    "cancel_settlement_auth",
                    "cancel accepted from a non-operator/non-pause signer",
                );
            }
        } else if (st.epoch_created_for as u128 + cfg.epochs_to_claim_settlement as u128)
            >= clock.epoch as u128
        {
            self.flag(
                "close_before_expiry",
                format!(
                    "close accepted before expiry (created {} + {} >= epoch {})",
                    st.epoch_created_for, cfg.epochs_to_claim_settlement, clock.epoch
                ),
            );
        }
        if e.post.lamports(&addr) != 0 || e.post.lamports(&claims) != 0 {
            self.flag("close_not_closed", "settlement accounts not closed");
        }
        let _ = (rc_pre, vi);
    }

    // ============================= stake ops ====================================

    pub fn act_stake_ops(&mut self, t: &mut Trident) {
        if self.stakes.is_empty() {
            return;
        }
        let cfg = self.cfg(t);
        let pda = self.bonds_pda();
        match t.random_from_range(0..3u32) {
            0 => {
                // merge two stakes sharing authorities
                let a = pick(t, &self.stakes);
                let ma = stake_meta(&t.get_account(&a));
                let peers: Vec<Pubkey> = self
                    .stakes
                    .iter()
                    .copied()
                    .filter(|k| {
                        *k != a
                            && t.get_account(k).lamports() > 0
                            && stake_meta(&t.get_account(k))
                                .map(|m| {
                                    Some(m.authorized.staker)
                                        == ma.as_ref().map(|x| x.authorized.staker)
                                })
                                .unwrap_or(false)
                    })
                    .collect();
                let b = if peers.is_empty() || chance(t, 15) {
                    pick(t, &self.stakes)
                } else {
                    pick(t, &peers)
                };
                let staker = if chance(t, 90) {
                    ma.as_ref().map(|m| m.authorized.staker).unwrap_or(pda)
                } else {
                    pick(t, &self.actors)
                };
                let settlement = if chance(t, 80) {
                    self.settlements
                        .iter()
                        .map(|s| s.addr)
                        .find(|s| settlement_staker_authority(s) == staker)
                        .unwrap_or_else(|| t.random_pubkey())
                } else {
                    t.random_pubkey()
                };
                let (pa, pb) = (t.get_account(&a), t.get_account(&b));
                let e = self.exec(
                    t,
                    "merge_stake",
                    merge_stake(self.config, a, b, staker, settlement),
                );
                if e.ok {
                    let (ma, mb) = (stake_meta(&pa), stake_meta(&pb));
                    let both_bond = ma
                        .as_ref()
                        .map(|m| m.authorized.withdrawer == pda)
                        .unwrap_or(false)
                        && mb
                            .as_ref()
                            .map(|m| m.authorized.withdrawer == pda)
                            .unwrap_or(false);
                    if !both_bond
                        || ma.map(|m| m.authorized.staker) != mb.map(|m| m.authorized.staker)
                    {
                        self.flag(
                            "merge_foreign_stake",
                            "merged stakes that are not both funded with matching stakers",
                        );
                    }
                    if e.post.lamports(&a) != 0 && e.post.lamports(&b) != 0 {
                        self.flag("merge_no_drain", "merge did not close the source");
                    }
                    if stake_delegation(&pa).map(|d| d.voter_pubkey)
                        != stake_delegation(&pb).map(|d| d.voter_pubkey)
                    {
                        self.flag(
                            "merge_different_votes",
                            "merged stakes delegated to different vote accounts",
                        );
                    }
                }
            }
            1 => {
                // reset: stakes funded to a (usually closed) settlement go back to the bond
                let Some(si) = self.pick_settlement(t, true) else {
                    return;
                };
                let addr = if chance(t, 90) {
                    self.settlements[si].addr
                } else {
                    t.random_pubkey()
                };
                let sauth = settlement_staker_authority(&self.settlements[si].addr);
                let c: Vec<Pubkey> = self
                    .stakes
                    .iter()
                    .copied()
                    .filter(|k| {
                        stake_meta(&t.get_account(k))
                            .map(|m| m.authorized.staker == sauth)
                            .unwrap_or(false)
                            && t.get_account(k).lamports() > 0
                    })
                    .collect();
                let stake = if c.is_empty() || chance(t, 10) {
                    pick(t, &self.stakes)
                } else {
                    pick(t, &c)
                };
                let vi = if chance(t, 90) {
                    self.settlements[si].vote_idx
                } else {
                    t.random_from_range(0..self.votes.len())
                };
                let v = self.votes[vi].clone();
                let live = e_live(self, t, &addr);
                let pre = t.get_account(&stake);
                let e = self.exec(
                    t,
                    "reset_stake",
                    reset_stake(self.config, v.bond, addr, stake, v.vote),
                );
                if e.ok {
                    let m = stake_meta(&pre).unwrap();
                    if live {
                        self.flag(
                            "reset_live_settlement",
                            "reset_stake succeeded while the settlement account is live",
                        );
                    }
                    if m.authorized.staker != settlement_staker_authority(&addr)
                        || m.authorized.withdrawer != pda
                    {
                        self.flag(
                            "reset_wrong_stake",
                            "reset_stake accepted a stake not funded to the given settlement",
                        );
                    }
                    if stake_meta(&e.post.get(&stake)).map(|m| m.authorized.staker) != Some(pda) {
                        self.flag("reset_staker", "staker not reset to the bonds authority");
                    }
                    if stake_delegation(&pre).map(|d| d.voter_pubkey) != Some(v.vote) {
                        self.flag(
                            "reset_wrong_vote",
                            "stake of another vote account reset into this bond",
                        );
                    }
                }
            }
            _ => {
                // withdraw_stake: operator withdraws a non-delegated stake of a closed settlement
                let Some(si) = self.pick_settlement(t, true) else {
                    return;
                };
                let addr = self.settlements[si].addr;
                let sauth = settlement_staker_authority(&addr);
                let stake = if chance(t, 60) {
                    // craft an initialized stake with settlement staker
                    self.donated.insert(addr);
                    let acc = make_stake(
                        None,
                        sauth,
                        pda,
                        Lockup::default(),
                        0,
                        t.random_from_range(0..SOL),
                        Activation::Active,
                        0,
                    );
                    self.new_stake(t, acc)
                } else {
                    pick(t, &self.stakes)
                };
                let signer = self.signer(t, cfg.operator_authority);
                let to = pick(t, &self.actors);
                let live = e_live(self, t, &addr);
                let pre = t.get_account(&stake);
                let e = self.exec(
                    t,
                    "withdraw_stake",
                    withdraw_stake(self.config, signer, addr, stake, to),
                );
                if e.ok {
                    let m = stake_meta(&pre).unwrap();
                    if signer != cfg.operator_authority
                        || live
                        || m.authorized.staker != sauth
                        || m.authorized.withdrawer != pda
                        || !matches!(decode_stake(&pre), Some(StakeStateV2::Initialized(_)))
                    {
                        self.flag(
                            "withdraw_stake_precondition",
                            format!(
                                "accepted: operator={} live={live}",
                                signer == cfg.operator_authority
                            ),
                        );
                    }
                }
            }
        }
    }

    // ================================ time ======================================

    pub fn act_time(&mut self, t: &mut Trident) {
        let c = self.clock(t);
        let de = *[0u64, 0, 0, 1, 1, 2, 4]
            .get(t.random_from_range(0..7usize))
            .unwrap();
        t.warp_to_epoch(c.epoch + de);
        let ds = t.random_from_range(0..400u64) + de * 1000;
        t.warp_to_slot(c.slot + ds);
        let dt = t.random_from_range(0..2000i64);
        t.forward_in_time(dt);
    }
}

fn e_live(w: &World, t: &mut Trident, addr: &Pubkey) -> bool {
    let _ = w;
    let a = t.get_account(addr);
    a.lamports() > 0 && a.owner() != &SYSTEM
}
