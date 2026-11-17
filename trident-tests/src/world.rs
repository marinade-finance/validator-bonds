//! Shared fuzz state, transaction execution and the invariants checked after every transaction.

use std::collections::{BTreeSet, HashMap, HashSet};

use solana_sdk::clock::Clock;
use solana_sdk::instruction::InstructionError;
use solana_stake_interface::state::{Lockup, StakeStateV2};
use trident_fuzz::fuzzing::*;

use crate::ix::*;
use crate::merkle::{Leaf, Tree};
use crate::state::*;

pub const SOL: u64 = LAMPORTS_PER_SOL;
const STATE_JSON: &str = include_str!(
    "../../fixtures/accounts-marinade-liquid/8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC.json"
);
const LIST_JSON: &str = include_str!(
    "../../fixtures/accounts-marinade-liquid/Anv3XE7e5saNdm16MU6bniYS59Mpv7DzQXHAhxJUmAKW.json"
);

// ---- statistics -----------------------------------------------------------------

static STATS: std::sync::Mutex<Option<std::collections::BTreeMap<(String, String), u64>>> =
    std::sync::Mutex::new(None);

/// Counts outcomes per instruction; dumps them to `$FUZZ_STATS` every few hundred transactions.
fn record(name: &str, outcome: String) {
    let Ok(path) = std::env::var("FUZZ_STATS") else {
        return;
    };
    let mut g = STATS.lock().unwrap();
    let m = g.get_or_insert_with(Default::default);
    *m.entry((name.to_string(), outcome)).or_default() += 1;
    let total: u64 = m.values().sum();
    if total.is_multiple_of(500) {
        let mut out = String::new();
        for ((n, o), c) in m.iter() {
            out.push_str(&format!("{n}\t{o}\t{c}\n"));
        }
        let _ = std::fs::write(path, out);
    }
}

fn post_payer_lamports(t: &mut Trident, k: &Pubkey) -> u64 {
    t.get_account(k).lamports()
}

// ---- random helpers -----------------------------------------------------------

pub fn chance(t: &mut Trident, pct: u32) -> bool {
    t.random_from_range(0..100u32) < pct
}
pub fn pick<T: Clone>(t: &mut Trident, v: &[T]) -> T {
    v[t.random_from_range(0..v.len())].clone()
}

// ---- snapshots ----------------------------------------------------------------

#[derive(Default, Clone)]
pub struct Snap(pub HashMap<Pubkey, AccountSharedData>);

impl Snap {
    pub fn get(&self, k: &Pubkey) -> AccountSharedData {
        self.0.get(k).cloned().unwrap_or_default()
    }
    pub fn lamports(&self, k: &Pubkey) -> u64 {
        self.0.get(k).map(|a| a.lamports()).unwrap_or(0)
    }
    pub fn exists(&self, k: &Pubkey) -> bool {
        self.0
            .get(k)
            .map(|a| a.lamports() > 0 && a.owner() != &SYSTEM)
            .unwrap_or(false)
    }
}

pub struct Exec {
    pub name: &'static str,
    pub ok: bool,
    pub code: Option<u32>,
    pub pre: Snap,
    pub post: Snap,
    pub cfg_pre: Option<Config>,
    pub clock: Clock,
    pub err: String,
    pub logs: String,
}

impl Exec {
    pub fn failed_with(&self, code: u32) -> bool {
        !self.ok && self.code == Some(code)
    }
}

// ---- model ----------------------------------------------------------------------

#[derive(Clone)]
pub struct VoteInfo {
    pub vote: Pubkey,
    pub identity: Pubkey,
    pub bond: Pubkey,
}

pub struct Stl {
    pub addr: Pubkey,
    pub vote_idx: usize,
    pub leaves: Vec<Leaf>,
    pub dest: Vec<Pubkey>,
    pub tree: Tree,
    pub claimed: BTreeSet<u64>,
    pub claimed_lamports: u64,
}

pub struct World {
    pub payer: Pubkey,
    pub config: Pubkey,
    pub admin: Pubkey,
    pub operator: Pubkey,
    pub actors: Vec<Pubkey>,
    pub votes: Vec<VoteInfo>,
    pub stakes: Vec<Pubkey>,
    pub settlements: Vec<Stl>,
    pub msol_members: Vec<Pubkey>,
    pub products: Vec<(usize, Pubkey)>,
    /// settlements that received stake from outside `fund_settlement` (crafted by the harness)
    pub donated: HashSet<Pubkey>,
    /// set once the admin lowered `minimum_stake_lamports`: the reserve of earlier funded stakes becomes claimable
    pub min_lowered: bool,
    /// instructions are mutated (account swaps, junk vote accounts, data tweaks) before execution
    pub mutating: bool,
    ignore: HashSet<String>,
}

impl World {
    pub fn empty(_t: &Trident) -> Self {
        let ignore = std::env::var("FUZZ_IGNORE")
            .map(|s| s.split(',').map(|x| x.trim().to_string()).collect())
            .unwrap_or_default();
        World {
            payer: Pubkey::default(),
            config: Pubkey::default(),
            admin: Pubkey::default(),
            operator: Pubkey::default(),
            actors: vec![],
            votes: vec![],
            stakes: vec![],
            settlements: vec![],
            msol_members: vec![],
            products: vec![],
            donated: HashSet::new(),
            min_lowered: false,
            mutating: false,
            ignore,
        }
    }

    /// A violated invariant. Aborts the iteration (Trident prints the seed) unless named in `FUZZ_IGNORE`.
    pub fn flag(&self, key: &str, msg: impl AsRef<str>) {
        if self.ignore.contains(key) {
            return;
        }
        let one_line = msg
            .as_ref()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        // Trident only prints panics through its progress bar, which is hidden without a terminal
        if !self.mutating || Self::is_generic_finding(&format!("[{key}]")) {
            eprintln!("FINDING [{key}] {one_line}");
        }
        panic!("[{key}] {one_line}");
    }

    // ---- setup --------------------------------------------------------------------

    pub fn setup(&mut self, t: &mut Trident, n_votes: usize) {
        *self = World::empty(t);
        // not the Trident fee payer: its balance is tracked separately by the SVM
        self.payer = t.random_pubkey();
        self.config = t.random_pubkey();
        self.admin = t.random_pubkey();
        self.operator = t.random_pubkey();
        self.actors = vec![self.admin, self.operator];
        for _ in 0..4 {
            let a = t.random_pubkey();
            self.actors.push(a);
        }
        t.airdrop(&self.payer.clone(), 1_000_000 * SOL);
        let _ = t.payer();

        for json in [STATE_JSON, LIST_JSON] {
            let (k, acc) = load_fixture(json);
            t.set_account_custom(&k, &acc);
        }
        let state = t.get_account(&MARINADE_LIQUID_STATE);
        let list = t.get_account(&MARINADE_STAKE_LIST);
        self.msol_members = stake_list_members(&state, &list)
            .into_iter()
            .take(24)
            .collect();

        let epoch = t.random_from_range(5..12u64);
        t.warp_to_epoch(epoch);
        t.warp_to_slot(epoch * 1000);

        for _ in 0..n_votes {
            let identity = t.random_pubkey();
            let withdrawer = t.random_pubkey();
            let vote = t.random_pubkey();
            t.set_account_custom(&vote, &make_vote(identity, withdrawer));
            self.actors.push(identity);
            let bond = bond_address(&self.config, &vote);
            self.votes.push(VoteInfo {
                vote,
                identity,
                bond,
            });
        }
    }

    /// `init_config` with randomized parameters. Returns the result of the instruction.
    pub fn init_config(&mut self, t: &mut Trident) -> Exec {
        let args = InitConfigArgs {
            admin_authority: self.admin,
            operator_authority: self.operator,
            epochs_to_claim_settlement: t.random_from_range(1..4),
            withdraw_lockup_epochs: t.random_from_range(0..3),
            slots_to_start_settlement_claiming: *[0u64, 0, 0, 50, 3000]
                .get(t.random_from_range(0..5usize))
                .unwrap(),
        };
        let ix = init_config(self.config, self.payer, &args);
        let e = self.exec(t, "init_config", ix);
        if e.ok {
            let c: Config = decode(&e.post.get(&self.config)).expect("config decodes");
            if c.admin_authority != args.admin_authority
                || c.operator_authority != args.operator_authority
                || c.pause_authority != args.admin_authority
                || c.paused
                || c.epochs_to_claim_settlement != args.epochs_to_claim_settlement
                || c.withdraw_lockup_epochs != args.withdraw_lockup_epochs
                || c.slots_to_start_settlement_claiming != args.slots_to_start_settlement_claiming
                || c.minimum_stake_lamports != SOL
                || c.bonds_withdrawer_authority_bump
                    != Pubkey::find_program_address(
                        &[b"bonds_authority", self.config.as_ref()],
                        &PROGRAM_ID,
                    )
                    .1
            {
                self.flag(
                    "init_config_state",
                    format!("config state differs from args: {c:?} vs {args:?}"),
                );
            }
        } else {
            self.flag(
                "init_config_failed",
                format!("init_config failed: {:?}", e.code),
            );
        }
        e
    }

    // ---- accessors -----------------------------------------------------------------

    pub fn cfg(&self, t: &mut Trident) -> Config {
        decode(&t.get_account(&self.config)).expect("config exists")
    }
    pub fn bond_of(&self, t: &mut Trident, vi: usize) -> Option<Bond> {
        decode(&t.get_account(&self.votes[vi].bond))
    }
    pub fn clock(&self, t: &Trident) -> Clock {
        t.get_sysvar::<Clock>()
    }
    pub fn bonds_pda(&self) -> Pubkey {
        bonds_authority(&self.config)
    }
    pub fn settlement_state(&self, t: &mut Trident, si: usize) -> Option<Settlement> {
        decode(&t.get_account(&self.settlements[si].addr))
    }

    /// Candidate signer: the right one most of the time, otherwise some other actor.
    pub fn signer(&self, t: &mut Trident, right: Pubkey) -> Pubkey {
        if chance(t, 70) {
            right
        } else {
            pick(t, &self.actors)
        }
    }

    pub fn new_stake(&mut self, t: &mut Trident, acc: AccountSharedData) -> Pubkey {
        let k = t.random_pubkey();
        t.set_account_custom(&k, &acc);
        self.stakes.push(k);
        k
    }

    /// A delegated stake account owned (staker+withdrawer) by `owner`.
    pub fn new_owned_stake(
        &mut self,
        t: &mut Trident,
        vi: Option<usize>,
        owner: Pubkey,
        delegated: u64,
        act: Activation,
    ) -> Pubkey {
        let epoch = self.clock(t).epoch;
        let vote = vi.map(|i| self.votes[i].vote);
        let acc = make_stake(
            vote,
            owner,
            owner,
            Lockup::default(),
            delegated,
            0,
            act,
            epoch,
        );
        self.new_stake(t, acc)
    }

    fn tracked_keys(&self) -> Vec<Pubkey> {
        let mut v = vec![
            self.config,
            self.bonds_pda(),
            MARINADE_LIQUID_STATE,
            MARINADE_STAKE_LIST,
        ];
        for vi in &self.votes {
            v.push(vi.bond);
            v.push(withdraw_request_address(&vi.bond));
        }
        for (_, p) in &self.products {
            v.push(*p);
        }
        for s in &self.settlements {
            v.push(s.addr);
            v.push(settlement_claims_address(&s.addr));
            v.push(settlement_staker_authority(&s.addr));
            v.extend(s.dest.iter().copied());
        }
        v.extend(self.stakes.iter().copied());
        v
    }

    fn snapshot(&self, t: &mut Trident, extra: &[Pubkey]) -> Snap {
        let mut m = HashMap::new();
        for k in self.tracked_keys().into_iter().chain(extra.iter().copied()) {
            m.entry(k).or_insert_with(|| t.get_account(&k));
        }
        Snap(m)
    }

    // ---- execution ----------------------------------------------------------------

    /// Account substitution / duplication, junk vote accounts, flag flips, truncated or extended data.
    fn mutate_ix(&self, t: &mut Trident, name: &str, mut ix: Instruction) -> Instruction {
        // A corrupted length prefix of a `Vec<u8>` / `String` argument makes borsh reserve more than the 32 KiB heap
        // (generic Anchor/borsh behaviour, the transaction just fails): leave those arguments intact.
        let keep_data = name.ends_with("bond_product");
        let pool = self.tracked_keys();
        let n = ix.accounts.len();
        for _ in 0..t.random_from_range(1..=2usize) {
            match t.random_from_range(0..12u32) {
                0..=3 => {
                    let i = t.random_from_range(0..n);
                    let k = if chance(t, 30) {
                        t.random_pubkey()
                    } else {
                        pick(t, &pool)
                    };
                    ix.accounts[i].pubkey = k;
                }
                4 | 5 => {
                    let (i, j) = (t.random_from_range(0..n), t.random_from_range(0..n));
                    ix.accounts[i].pubkey = ix.accounts[j].pubkey;
                }
                6 => {
                    let i = t.random_from_range(0..n);
                    ix.accounts[i].is_signer = !ix.accounts[i].is_signer;
                }
                7 | 8 => {
                    // an account owned by the vote program with zeroed data of an odd length
                    let len = *[0usize, 1, 3, 4, 35, 36, 67, 100, 3762]
                        .get(t.random_from_range(0..9usize))
                        .unwrap();
                    let fake = t.random_pubkey();
                    let acc = AccountSharedData::new(10_000_000_000, len, &VOTE_PROGRAM);
                    t.set_account_custom(&fake, &acc);
                    if let Some(m) = ix
                        .accounts
                        .iter_mut()
                        .find(|m| self.votes.iter().any(|v| v.vote == m.pubkey))
                    {
                        m.pubkey = fake;
                        if std::env::var("FUZZ_TRACE").is_ok() {
                            eprintln!("  junk vote len {len}");
                        }
                    }
                }
                9 if !keep_data => {
                    let len = ix.data.len();
                    match t.random_from_range(0..3u32) {
                        0 if len > 8 => ix.data.truncate(t.random_from_range(8..len)),
                        1 => {
                            let extra = t.random_from_range(1..40usize);
                            let mut b = vec![0u8; extra];
                            t.random_bytes(&mut b);
                            ix.data.extend(b);
                        }
                        _ if len > 8 => {
                            let i = t.random_from_range(8..len);
                            ix.data[i] ^= 1 << t.random_from_range(0..8u32);
                        }
                        _ => {}
                    }
                }
                10 => ix
                    .accounts
                    .push(AccountMeta::new_readonly(pick(t, &pool), false)),
                _ => {
                    let i = t.random_from_range(0..n);
                    ix.accounts[i].is_writable = !ix.accounts[i].is_writable;
                }
            }
        }
        // the runtime demotes writable sysvars and programs to read-only
        let readonly_keys = [
            CLOCK,
            RENT,
            STAKE_HISTORY,
            STAKE_PROGRAM,
            SYSTEM,
            VOTE_PROGRAM,
            TOKEN_PROGRAM,
            ATA_PROGRAM,
            METADATA_PROGRAM,
            PROGRAM_ID,
        ];
        // nobody holds a private key for a program derived address: such an account can never sign
        for m in ix.accounts.iter_mut() {
            if readonly_keys.contains(&m.pubkey) {
                m.is_writable = false;
            }
            if !m.pubkey.is_on_curve() {
                m.is_signer = false;
            }
        }
        ix
    }

    pub fn exec(&mut self, t: &mut Trident, name: &'static str, ix: Instruction) -> Exec {
        let ix = if self.mutating {
            self.mutate_ix(t, name, ix)
        } else {
            ix
        };
        let keys: Vec<Pubkey> = ix.accounts.iter().map(|m| m.pubkey).collect();
        let pre = self.snapshot(t, &keys);
        let cfg_pre = decode::<Config>(&pre.get(&self.config));
        let clock = self.clock(t);
        if let Ok(k) = std::env::var("FUZZ_TRACE_KEY") {
            if let Some(pos) = ix.accounts.iter().position(|m| m.pubkey.to_string() == k) {
                eprintln!(
                    "  KEY {k} used by {name} at account index {pos} (mutating={})",
                    self.mutating
                );
            }
        }
        let ix_data_hex = hex::encode(&ix.data[..ix.data.len().min(160)]);
        let res = t.process_transaction(std::slice::from_ref(&ix), Some(name));
        // the chain purges zero-lamport accounts at the end of the slot; the SVM keeps their owner and data
        for k in &keys {
            let a = t.get_account(k);
            if a.lamports() == 0 && (a.owner() != &SYSTEM || !a.data().is_empty()) {
                t.set_account_custom(k, &AccountSharedData::default());
            }
        }
        let post = self.snapshot(t, &keys);
        let (ok, code) = (res.is_success(), res.get_custom_error_code());
        let logs = res.logs();
        if std::env::var("FUZZ_TRACE").is_ok() {
            eprintln!(
                "{name}: ok={ok} code={code:?} mutating={} payer={} -> {}",
                self.mutating,
                pre.lamports(&self.payer),
                post_payer_lamports(t, &self.payer)
            );
        }

        if let Err(TransactionError::InstructionError(_, e)) = res.get_result() {
            let bad = matches!(
                e,
                InstructionError::ProgramFailedToComplete
                    | InstructionError::ComputationalBudgetExceeded
                    | InstructionError::ProgramFailedToCompile
                    | InstructionError::ArithmeticOverflow
                    | InstructionError::InvalidError
            );
            if bad || logs.contains("panicked at") {
                let panic_line = logs
                    .lines()
                    .find(|l| l.contains("panicked at"))
                    .unwrap_or("")
                    .trim()
                    .to_string();
                self.flag(
                    &format!("{name}_panic"),
                    format!("{name}: program aborted with {e:?} {panic_line} data={ix_data_hex}\nlogs: {logs}"),
                );
            }
        }

        let err = format!("{:?}", res.get_result());
        record(
            name,
            if ok {
                "ok".into()
            } else {
                code.map(|c| c.to_string()).unwrap_or_else(|| err.clone())
            },
        );
        let e = Exec {
            name,
            ok,
            code,
            pre,
            post,
            cfg_pre,
            clock,
            err,
            logs,
        };
        self.check_generic(t, &e, &keys);
        if self.mutating {
            // a mutated transaction may turn a wallet into a program-owned account (it signed for it);
            // keep the harness wallets usable for the rest of the iteration
            let payer = t.get_account(&self.payer);
            if payer.lamports() < 500_000 * SOL {
                t.airdrop(&self.payer.clone(), 1_000_000 * SOL);
            }
            for k in std::iter::once(self.payer).chain(self.actors.iter().copied()) {
                let a = t.get_account(&k);
                if a.owner() != &SYSTEM || !a.data().is_empty() {
                    let before = e.pre.get(&k);
                    if before.owner() == &SYSTEM && before.data().is_empty() {
                        t.set_account_custom(&k, &before);
                    }
                }
            }
        }
        e
    }

    /// Findings raised by the generic checks (valid for any instruction, mutated or not).
    pub fn is_generic_finding(msg: &str) -> bool {
        const GENERIC: [&str; 18] = [
            "lamports_not_conserved",
            "paused_not_blocking",
            "config_changed_by_other_ix",
            "pause_flag_changed_by_other_ix",
            "bond_changed_by_other_ix",
            "bond_identity_changed",
            "bond_closed",
            "delegation_changed",
            "withdrawer_escaped",
            "staker_changed",
            "lockup_changed",
            "settlement_stake_drained",
            "stake_closed",
            "not_rent_exempt",
            "claimed_exceeds_max_total",
            "claims_exceed_max_nodes",
            "bitmap_count_mismatch",
            "failed_tx_changed_state",
        ];
        let key = msg
            .strip_prefix('[')
            .and_then(|m| m.split(']').next())
            .unwrap_or("");
        GENERIC.contains(&key) || key.ends_with("_panic")
    }

    // ---- generic invariants ----------------------------------------------------------

    fn check_generic(&mut self, t: &mut Trident, e: &Exec, ix_keys: &[Pubkey]) {
        let name = e.name;
        if !e.ok {
            // a failed transaction must leave every tracked account untouched
            for (k, pre) in &e.pre.0 {
                if [CLOCK, STAKE_HISTORY, RENT].contains(k) {
                    continue; // sysvars are refreshed by the SVM on every transaction
                }
                let post = e.post.get(k);
                if pre.lamports() != post.lamports()
                    || pre.data() != post.data()
                    || pre.owner() != post.owner()
                {
                    self.flag(
                        "failed_tx_changed_state",
                        format!("{name} failed but account {k} changed"),
                    );
                }
            }
            return;
        }

        // lamports are conserved across the accounts the instruction touches
        let uniq: BTreeSet<_> = ix_keys.iter().copied().collect();
        let (b, a): (u128, u128) = uniq.iter().fold((0, 0), |(b, a), k| {
            (
                b + e.pre.lamports(k) as u128,
                a + e.post.lamports(k) as u128,
            )
        });
        if b != a {
            let detail: Vec<String> = uniq
                .iter()
                .filter(|k| e.pre.lamports(k) != e.post.lamports(k))
                .map(|k| {
                    format!(
                        "{k}: {} -> {} (owner {} -> {})",
                        e.pre.lamports(k),
                        e.post.lamports(k),
                        e.pre.get(k).owner(),
                        e.post.get(k).owner()
                    )
                })
                .collect();
            self.flag(
                "lamports_not_conserved",
                format!("{name}: lamports {b} -> {a} over instruction accounts; changed: {detail:?}; accounts: {:?}", ix_keys.iter().map(|k| (k.to_string(), e.pre.lamports(k), e.pre.get(k).owner().to_string())).collect::<Vec<_>>()),
            );
        }

        // paused config blocks everything except config administration and claims-account upsizing
        let allowed_while_paused = [
            "init_config",
            "configure_config",
            "emergency_pause",
            "emergency_resume",
            "upsize_settlement_claims",
        ];
        if let Some(c) = &e.cfg_pre {
            if c.paused && !allowed_while_paused.contains(&name) {
                self.flag(
                    "paused_not_blocking",
                    format!("{name} succeeded while config is paused"),
                );
            }
        }

        let cfg_post = decode::<Config>(&e.post.get(&self.config));
        if let (Some(a), Some(b)) = (&e.cfg_pre, &cfg_post) {
            let admin_changed = a.admin_authority != b.admin_authority
                || a.operator_authority != b.operator_authority
                || a.pause_authority != b.pause_authority
                || a.epochs_to_claim_settlement != b.epochs_to_claim_settlement
                || a.withdraw_lockup_epochs != b.withdraw_lockup_epochs
                || a.minimum_stake_lamports != b.minimum_stake_lamports
                || a.slots_to_start_settlement_claiming != b.slots_to_start_settlement_claiming
                || a.min_bond_max_stake_wanted != b.min_bond_max_stake_wanted
                || a.bonds_withdrawer_authority_bump != b.bonds_withdrawer_authority_bump;
            if admin_changed && name != "configure_config" {
                self.flag(
                    "config_changed_by_other_ix",
                    format!("{name} changed config"),
                );
            }
            if a.paused != b.paused && !["emergency_pause", "emergency_resume"].contains(&name) {
                self.flag(
                    "pause_flag_changed_by_other_ix",
                    format!("{name} changed paused flag"),
                );
            }
        }

        // every touched account is closed or rent exempt
        let rent = solana_sdk::rent::Rent::default();
        for (k, acc) in &e.post.0 {
            if acc.lamports() == 0 || [CLOCK, STAKE_HISTORY, RENT].contains(k) {
                continue;
            }
            let need = match stake_meta(acc) {
                Some(m) => m.rent_exempt_reserve,
                None => rent.minimum_balance(acc.data().len()),
            };
            let program_owned = [PROGRAM_ID, STAKE_PROGRAM].contains(acc.owner());
            if program_owned && acc.lamports() < need {
                self.flag(
                    "not_rent_exempt",
                    format!("{name}: {k} holds {} < {need}", acc.lamports()),
                );
            }
        }

        self.check_bonds(e);
        self.check_stakes(t, e);
        self.check_settlements(t, e);
    }

    fn check_bonds(&self, e: &Exec) {
        for vi in &self.votes {
            let (a, b) = (
                decode::<Bond>(&e.pre.get(&vi.bond)),
                decode::<Bond>(&e.post.get(&vi.bond)),
            );
            match (a, b) {
                (Some(a), Some(b)) => {
                    let changed = a.authority != b.authority
                        || a.cpmpe != b.cpmpe
                        || a.max_stake_wanted != b.max_stake_wanted
                        || a.vote_account != b.vote_account
                        || a.config != b.config;
                    if changed && !["configure_bond", "configure_bond_with_mint"].contains(&e.name)
                    {
                        self.flag(
                            "bond_changed_by_other_ix",
                            format!("{} changed bond {}", e.name, vi.bond),
                        );
                    }
                    if a.vote_account != b.vote_account || a.config != b.config {
                        self.flag(
                            "bond_identity_changed",
                            "bond config/vote_account must be immutable",
                        );
                    }
                }
                (Some(_), None) => self.flag("bond_closed", format!("{} closed a bond", e.name)),
                _ => {}
            }
        }
    }

    fn check_stakes(&self, t: &mut Trident, e: &Exec) {
        let pda = self.bonds_pda();
        let settlement_auths: HashMap<Pubkey, usize> = (0..self.settlements.len())
            .map(|i| (settlement_staker_authority(&self.settlements[i].addr), i))
            .collect();
        for k in &self.stakes {
            let (pre, post) = (e.pre.get(k), e.post.get(k));
            if pre.lamports() == 0 && post.lamports() == 0 {
                continue;
            }
            // delegation of an existing stake is never moved to another vote account
            if let (Some(a), Some(b)) = (stake_delegation(&pre), stake_delegation(&post)) {
                if a.voter_pubkey != b.voter_pubkey {
                    self.flag("delegation_changed", format!("{} re-delegated {k}", e.name));
                }
            }
            let (ma, mb) = (stake_meta(&pre), stake_meta(&post));
            if let (Some(a), Some(b)) = (&ma, &mb) {
                // withdrawer leaves the bonds PDA only through claim_withdraw_request
                if a.authorized.withdrawer == pda
                    && b.authorized.withdrawer != pda
                    && e.name != "claim_withdraw_request"
                {
                    self.flag(
                        "withdrawer_escaped",
                        format!(
                            "{} moved withdrawer of {k} away from the bonds authority",
                            e.name
                        ),
                    );
                }
                // staker handover is limited to fund_bond / fund_settlement / reset_stake / claim_withdraw_request
                if a.authorized.staker != b.authorized.staker
                    && ![
                        "fund_bond",
                        "fund_settlement",
                        "reset_stake",
                        "claim_withdraw_request",
                    ]
                    .contains(&e.name)
                {
                    self.flag(
                        "staker_changed",
                        format!("{} changed staker of {k}", e.name),
                    );
                }
                if a.lockup != b.lockup {
                    self.flag(
                        "lockup_changed",
                        format!("{} changed lockup of {k}", e.name),
                    );
                }
                // stake funded to a live settlement keeps its lamports until claimed / refunded
                if let Some(si) = settlement_auths.get(&a.authorized.staker) {
                    let live = e.pre.exists(&self.settlements[*si].addr);
                    let decreased = post.lamports() < pre.lamports();
                    let allowed = [
                        "claim_settlement_v2",
                        "close_settlement_v2",
                        "cancel_settlement",
                    ]
                    .contains(&e.name);
                    if live && decreased && !allowed {
                        self.flag(
                            "settlement_stake_drained",
                            format!("{} reduced stake {k} funded to live settlement", e.name),
                        );
                    }
                }
            }
            if pre.lamports() > 0
                && post.lamports() == 0
                && ![
                    "claim_settlement_v2",
                    "withdraw_stake",
                    "merge_stake",
                    "claim_withdraw_request",
                    "fund_settlement",
                ]
                .contains(&e.name)
            {
                self.flag("stake_closed", format!("{} closed stake {k}", e.name));
            }
        }
        let _ = t;
    }

    fn check_settlements(&self, t: &mut Trident, e: &Exec) {
        let _ = t;
        for s in &self.settlements {
            let acc = e.post.get(&s.addr);
            let Some(st) = decode::<Settlement>(&acc) else {
                continue;
            };
            let claims = e.post.get(&settlement_claims_address(&s.addr));
            if st.lamports_claimed > st.max_total_claim {
                self.flag(
                    "claimed_exceeds_max_total",
                    format!(
                        "{} claimed {} > max {}",
                        e.name, st.lamports_claimed, st.max_total_claim
                    ),
                );
            }
            if st.merkle_nodes_claimed > st.max_merkle_nodes {
                self.flag(
                    "claims_exceed_max_nodes",
                    format!(
                        "{} claims {} > max {}",
                        e.name, st.merkle_nodes_claimed, st.max_merkle_nodes
                    ),
                );
            }
            if st.lamports_claimed > st.lamports_funded
                && !self.donated.contains(&s.addr)
                && !self.min_lowered
            {
                self.flag(
                    "claimed_exceeds_funded",
                    format!(
                        "{} claimed {} > funded {}",
                        e.name, st.lamports_claimed, st.lamports_funded
                    ),
                );
            }
            if claims_bitmap_popcount(&claims) != st.merkle_nodes_claimed {
                self.flag(
                    "bitmap_count_mismatch",
                    format!(
                        "{}: bitmap {} != nodes_claimed {}",
                        e.name,
                        claims_bitmap_popcount(&claims),
                        st.merkle_nodes_claimed
                    ),
                );
            }
        }
    }

    /// Compares the on-chain claim counters with the claims the harness has seen succeed.
    pub fn check_claim_model(&self, t: &mut Trident, si: usize) {
        let s = &self.settlements[si];
        let Some(st) = decode::<Settlement>(&t.get_account(&s.addr)) else {
            return;
        };
        let claims = t.get_account(&settlement_claims_address(&s.addr));
        if st.merkle_nodes_claimed as usize != s.claimed.len()
            || st.lamports_claimed != s.claimed_lamports
        {
            self.flag(
                "claim_accounting_mismatch",
                format!(
                    "on-chain {}/{} vs model {}/{}",
                    st.merkle_nodes_claimed,
                    st.lamports_claimed,
                    s.claimed.len(),
                    s.claimed_lamports
                ),
            );
        }
        for idx in &s.claimed {
            if !claims_is_set(&claims, *idx) {
                self.flag("claimed_bit_cleared", format!("claim bit {idx} not set"));
            }
        }
    }

    pub fn stake_min_size(&self, e: &Exec, stake: &Pubkey) -> u64 {
        let meta = stake_meta(&e.pre.get(stake))
            .map(|m| m.rent_exempt_reserve)
            .unwrap_or(0);
        meta + e
            .cfg_pre
            .as_ref()
            .map(|c| c.minimum_stake_lamports)
            .unwrap_or(0)
    }

    pub fn stake_state_str(acc: &AccountSharedData) -> String {
        format!(
            "{:?}",
            decode_stake(acc).unwrap_or(StakeStateV2::Uninitialized)
        )
    }
}
