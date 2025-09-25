= Solana Program Fuzz Testing

This module contains fuzz tests based on
[Ackee Trident framework](https://ackee.xyz/trident/docs/latest/getting-started/getting-started/)
that is supported by [Honggfuzz-rs](https://github.com/google/honggfuzz) fuzzing framework.

NOTE: the Trident framework recently added new usable features
([1](https://github.com/Ackee-Blockchain/trident/pull/220), [2](https://github.com/Ackee-Blockchain/trident/pull/217)...)
unfortunately it's only supported with Anchor 0.30.x+ and Solana versions newer than 1.7.22.
Switching the project version dependencies is currently off the agenda.

## Prerequisites

- Installed [Solana tooling](https://solana.com/docs/intro/installation)
  version needs to be complement to version used within [`Anchor.toml`](../Anchor.toml) file.
  ```shell
  sh -c "$(curl -sSfL https://release.solana.com/v1.17.22/install)"
  solana --version
  > solana-cli 1.17.22 (src:dbf06e25; feat:3580551090, client:SolanaLabs)
  ```
- Installed [Anchor](https://www.anchor-lang.com/docs/installation) in the same version as the contract
  ```shell
  avm list
  anchor --version
  > anchor-cli 0.29.0
  ```
- [Trident dependencies installed](https://ackee.xyz/trident/docs/latest/getting-started/getting-started/#install-system-dependencies)

## Running fuzz tests

```shell
trident fuzz run fuzz_0
```

as a shortcut one can use the `package.json` script

```shell
pnpm test:fuzz
```

If all goes well then table with statistics is printed and that's it.

```
+-----------------------+---------------+------------+--------------+-----------+
| Instruction           | Invoked Total | Ix Success | Check Failed | Ix Failed |
+-----------------------+---------------+------------+--------------+-----------+
| ConfigureBond         | 109           | 109        | 0            | 0         |
+-----------------------+---------------+------------+--------------+-----------+
| ConfigureBondWithMint | 108           | 108        | 0            | 0         |
+-----------------------+---------------+------------+--------------+-----------+
| InitSettlement        | 3             | 2          | 0            | 0         |
+-----------------------+---------------+------------+--------------+-----------+
| FundBond              | 101           | 3          | 0            | 0         |
+-----------------------+---------------+------------+--------------+-----------+
| CancelSettlement      | 2             | 0          | 0            | 0         |
+-----------------------+---------------+------------+--------------+-----------+
| InitBond              | 109           | 109        | 0            | 0         |
+-----------------------+---------------+------------+--------------+-----------+
| ConfigureConfig       | 109           | 109        | 0            | 0         |
+-----------------------+---------------+------------+--------------+-----------+
| InitConfig            | 110           | 110        | 0            | 0         |
+-----------------------+---------------+------------+--------------+-----------+
| MintBond              | 104           | 104        | 0            | 0         |
+-----------------------+---------------+------------+--------------+-----------+
```

The list of tests that are executed is specified under [test_fuzz.rs](./fuzz_tests/fuzz_0/test_fuzz.rs) directory.

### Errors investigation

When error happens the `trident fuzz` informs you the test hits a panic
and that one needs to be investigated.

Reports and crash files are saved under `trident-tests/fuzz_tests/fuzzing/hfuzz_workspace/fuzz_0/` directory.

To check report from the run see
`cat trident-tests/fuzz_tests/fuzzing/hfuzz_workspace/fuzz_0/HONGGFUZZ.REPORT.TXT`.
The same directory may contain `*.fuzz` file with input that caused the crash.
Use `run-debug`.

```shell
cargo fuzz run-debug fuzz_0 <absolute-path-to-validator-bonds-directory>/trident-tests/fuzz_tests/fuzzing/hfuzz_workspace/fuzz_0/*.fuzz
```

Then one can see info like

```
Currently processing: InitConfig(InitConfig {
    accounts: InitConfigAccounts {
        config: 1,
        rent_payer: 1,
        system_program: 0,
    },
    data: InitConfigData {
        admin_authority: 0,
        operator_authority: 0,
        epochs_to_claim_settlement: 0,
        withdraw_lockup_epochs: 72057594038452228,
        slots_to_start_settlement_claiming: 18446742991377793024,
    },
})
thread 'main' panicked at /home/chalda/.cargo/registry/src/index.crates.io-6f17d22bba15001f/solana-sdk-1.17.22/src/transaction/mod.rs:710:13:
Transaction::sign failed with error NotEnoughSigners
```

#### Show more debug information

To get more details of particular test failures one usually needs to rerun the particular case.
To limit what is executed one need to change the [`test_fuzz.rs`](./fuzz_tests/fuzz_0/test_fuzz.rs) file
and comment out all the cases that should be ignored to be run.
Then change the [Test.toml](../Trident.toml) file to show all the debug information by setting the following properties
(plus good to set environment variables `export RUST_BACKTRACE=1` and `export RUST_LOG=debug`).

```toml
[honggfuzz]
iterations = 20
threads = 1
keep_output = true
verbose = true
```

## Troubleshooting

- Here's a revised version:

- Currently, the fuzz tests occasionally fail with a `BlockhashNotFound` error originating from the bank program test.
  The cause is unclear (discussed with the Trident team, who haven't encountered this issue but have faced others
  and mentioned it may work with a newer Agave Solana version).

- See youtube tutorials for details on the framework
  - [Solana Anchor Program Fuzzing with Trident I](https://www.youtube.com/watch?v=5JRVnxGW8kc)
  - [Solana Anchor Program Fuzzing with Trident I](https://www.youtube.com/watch?v=gMk6hm0x44M)
    Or check the [Solandy's Trident Solana tutorial](https://www.youtube.com/watch?v=gZo45atKgug).
