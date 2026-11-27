# Trident fuzz harness for the validator-bonds program

Instruction-level fuzzing of the on-chain program with [Trident](https://github.com/Ackee-Blockchain/trident)
(`trident-fuzz` 0.12.0). The harness is its own cargo workspace (Trident depends on `solana-sdk` 2.x, the program on
3.x) and drives the compiled program (`.so`, SBPF v0) through Trident's SVM.

- `src/ix.rs` instruction builders (account order from the IDL)
- `src/state.rs` account decoders and stake / vote / Marinade fixture builders
- `src/merkle.rs` merkle tree matching the on-chain verifier
- `src/world.rs` shared state, transaction execution, invariants checked after every transaction
- `src/acts.rs` fuzz actions with per-instruction oracles
- `src/bin/fuzz.rs` the Trident fuzz target (weighted flows, one of them mutates instructions)
- `tests/regressions.rs` deterministic cases: malformed or out-of-range inputs are rejected, pause blocks claims

## Setup

```sh
# Agave 3.1.12 toolchain (provides cargo-build-sbf; platform-tools are downloaded on first use)
mkdir -p ~/.local/solana
curl -sSfL https://release.anza.xyz/v3.1.12/solana-release-x86_64-unknown-linux-gnu.tar.bz2 \
  | tar -xj -C ~/.local/solana --strip-components=1
export PATH=$HOME/.local/solana/bin:$PATH
```

## Build and run

```sh
cd trident-tests
./build-program.sh                      # program -> target/deploy/validator_bonds.so (rerun after program changes)
cargo test --release                    # regression tests
FUZZ_ITERATIONS=5000 FUZZ_CALLS=60 cargo run --release --bin fuzz
```

Trident prints a failing iteration (invariant, seed) through a progress bar that is hidden without a terminal; wrap the
run in `script -qec "<command>" /dev/null` when redirecting output. Replay a failure with the printed seed:

```sh
FUZZ_TRACE=1 TRIDENT_FUZZ_DEBUG=<seed> cargo run --release --bin fuzz
```

Environment variables: `FUZZ_ITERATIONS`, `FUZZ_CALLS` (flow calls per iteration), `TRIDENT_WITH_EXIT_CODE=1` (exit
code 99 on a finding), `FUZZ_TRACE=1` (print every transaction outcome), `FUZZ_STATS=<file>` (per-instruction outcome
counts), `FUZZ_IGNORE=<key,key>` (skip named invariants), `FUZZ_FLAG_PANICS=1` (report program aborts as findings),
`FUZZING_METRICS=1 FUZZING_JSON=<file>` (Trident metrics).

## What is checked

After every transaction: failed transactions (including aborts) leave state untouched, lamports are conserved
over the accounts of the instruction, program and stake accounts stay rent exempt, a paused config blocks everything
except config administration, config and bond fields change only through their instructions, stake delegation never
moves to another vote account, stake authorities change only through the expected instructions, stake funded to a live
settlement keeps its lamports until claimed, settlement counters stay within `max_total_claim` / `max_merkle_nodes`
and match the claim bitmap.

Per instruction: privileged instructions succeed only for the right signer and valid state (config, bond, withdraw
request, settlement, stake operations), a claim succeeds only for a leaf of the tree with a valid proof, only once, only
into a destination matching the leaf authorities (and the Marinade stake list for mSOL leaves), moving exactly the
claimed amount, and a fully valid claim is not rejected (admin config values near `u64::MAX` are out of scope).
