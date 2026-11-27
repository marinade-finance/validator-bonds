use trident_fuzz::fuzzing::*;
use validator_bonds_fuzz::ix::*;
use validator_bonds_fuzz::world::{World, SOL};

#[derive(FuzzTestMethods)]
struct FuzzTest {
    trident: Trident,
    fuzz_accounts: (),
    world: World,
}

#[flow_executor]
impl FuzzTest {
    fn new() -> Self {
        let trident = Trident::default();
        let world = World::empty(&trident);
        Self {
            trident,
            fuzz_accounts: (),
            world,
        }
    }

    #[init]
    fn start(&mut self) {
        let (t, w) = (&mut self.trident, &mut self.world);
        w.setup(t, 4);
        w.init_config(t);
        // three of the four vote accounts get a bond up front, each with a funded stake
        for vi in 0..3 {
            let v = w.votes[vi].clone();
            let args = InitBondArgs {
                bond_authority: w.actors[2 + vi],
                cpmpe: 0,
                max_stake_wanted: 0,
            };
            let e = w.exec(
                t,
                "init_bond",
                init_bond(w.config, v.vote, Some(v.identity), v.bond, w.payer, &args),
            );
            assert!(e.ok, "initial init_bond failed: {:?}", e.code);
            w.ensure_funded_stake(t, vi, 10 * SOL);
        }
    }

    #[flow(weight = 4)]
    fn config(&mut self) {
        if self.trident.random_from_range(0..4u32) == 0 {
            self.world.act_reinit_config(&mut self.trident);
        } else {
            self.world.act_configure_config(&mut self.trident);
        }
    }

    #[flow(weight = 5)]
    fn pause_resume(&mut self) {
        self.world.act_pause_resume(&mut self.trident);
    }

    #[flow(weight = 3)]
    fn init_bond(&mut self) {
        self.world.act_init_bond(&mut self.trident);
    }

    #[flow(weight = 5)]
    fn configure_bond(&mut self) {
        self.world.act_configure_bond(&mut self.trident);
    }

    #[flow(weight = 3)]
    fn mint_bond(&mut self) {
        self.world.act_mint_configure(&mut self.trident);
    }

    #[flow(weight = 3)]
    fn bond_product(&mut self) {
        self.world.act_bond_product(&mut self.trident);
    }

    #[flow(weight = 8)]
    fn fund_bond(&mut self) {
        self.world.act_fund_bond(&mut self.trident);
    }

    #[flow(weight = 8)]
    fn withdraw(&mut self) {
        self.world.act_withdraw(&mut self.trident);
    }

    #[flow(weight = 8)]
    fn init_settlement(&mut self) {
        self.world.act_init_settlement(&mut self.trident, false);
    }

    #[flow(weight = 9)]
    fn fund_settlement(&mut self) {
        self.world.act_fund_settlement(&mut self.trident, None);
    }

    #[flow(weight = 16)]
    fn claim(&mut self) {
        self.world.act_claim(&mut self.trident);
    }

    #[flow(weight = 2)]
    fn upsize(&mut self) {
        self.world.act_upsize(&mut self.trident);
    }

    #[flow(weight = 5)]
    fn close_cancel(&mut self) {
        self.world.act_close_cancel(&mut self.trident);
    }

    #[flow(weight = 6)]
    fn stake_ops(&mut self) {
        self.world.act_stake_ops(&mut self.trident);
    }

    #[flow(weight = 5)]
    fn time(&mut self) {
        self.world.act_time(&mut self.trident);
    }

    /// Runs one of the actions with its instruction mutated; only the generic invariants apply.
    #[flow(weight = 10)]
    fn mutated(&mut self) {
        let (t, w) = (&mut self.trident, &mut self.world);
        let which = t.random_from_range(0..14u32);
        w.mutating = true;
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match which {
            0 => w.act_configure_config(t),
            1 => w.act_pause_resume(t),
            2 => w.act_init_bond(t),
            3 => w.act_configure_bond(t),
            4 => w.act_mint_configure(t),
            5 => w.act_bond_product(t),
            6 => w.act_fund_bond(t),
            7 => w.act_withdraw(t),
            8 => {
                w.act_init_settlement(t, false);
            }
            9 => w.act_fund_settlement(t, None),
            10 => w.act_claim(t),
            11 => w.act_close_cancel(t),
            12 => w.act_stake_ops(t),
            _ => w.act_upsize(t),
        }));
        w.mutating = false;
        if let Err(p) = r {
            let msg = p
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string()))
                .unwrap_or_default();
            // per-action oracles assume unmodified instructions; only generic invariants may fail here
            if World::is_generic_finding(&msg) {
                std::panic::resume_unwind(p);
            }
        }
    }

    #[end]
    fn end(&mut self) {}
}

/// `default` when unset; a set value that is not a number fails the run rather than falling back.
fn env_u64(name: &str, default: u64) -> u64 {
    match std::env::var(name) {
        Ok(v) => v
            .parse()
            .unwrap_or_else(|_| panic!("{name}={v:?} is not a whole number")),
        Err(_) => default,
    }
}

fn main() {
    FuzzTest::fuzz(env_u64("FUZZ_ITERATIONS", 1000), env_u64("FUZZ_CALLS", 60));
}
