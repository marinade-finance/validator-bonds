= Solana Program Fuzz Testing

This module contains fuzz tests based on
[Ackee Trident framework](https://ackee.xyz/trident/docs/latest/getting-started/getting-started/)
that is based on [Honggfuzz-rs](https://github.com/google/honggfuzz) fuzzing framework.

## Prerequisites

- Installed [Solana/Agave tooling](https://solana.com/docs/intro/installation)
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

- Project structure as required by [`trident init fuzz`](https://ackee.xyz/trident/docs/latest/fuzzing/first-steps/fuzz-test-initialization/#initialize-fuzz-test)  
  should be used. Otherwise, it makes some mess while executing.

  *NOTE:* When the directory structure is not preserved then one can check option `cargo ruzz --root <anchor-project-root>`.

## Running fuzz tests

```shell
cargo fuzz run fuzz_0
```

Reports and crash files are saved under `hfuzz_workspace/<fuzz_test_name>/crashes` directory.

To check report from the run see `cat hfuzz_workspace/fuzz_0/HONGGFUZZ.REPORT.TXT`.
The same directory may contain `HONGGFUZZ.FUZZ` file with input that caused the crash.
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

LLDB commands could to [print the backtrace,](https://www.cs.williams.edu/~morgan/cs136-f15/lldb.html)
but it seems does not work. To quit the console use `q`.


## Troubleshooting

- See youtube tutorials for details on the framework
    - [Solana Anchor Program Fuzzing with Trident I](https://www.youtube.com/watch?v=5JRVnxGW8kc)
    - [Solana Anchor Program Fuzzing with Trident I](https://www.youtube.com/watch?v=gMk6hm0x44M)
      Or check the [Solandy's Trident Solana tutorial](https://www.youtube.com/watch?v=gZo45atKgug).

- On running `trident fuzz run-debug` failure `ModuleNotFoundError: No module named 'lldb.embedded_interpreter'`
  has been observed. I was able to fix it as explained at
  [github issue #55575](https://github.com/llvm/llvm-project/issues/55575#issuecomment-1247426995)

- For Ubuntu to install newer versions of LVM toolchain see https://apt.llvm.org/
  It could be like

  ```shell
  sudo echo 'deb http://apt.llvm.org/jammy/ llvm-toolchain-jammy main
  deb-src http://apt.llvm.org/jammy/ llvm-toolchain-jammy main' > /etc/apt/sources.list.d/llvm-toolchain.list
  sudo wget -O - https://apt.llvm.org/llvm-snapshot.gpg.key|sudo apt-key add -
  ```

- On `run-debug` for a crash file is printed `This crashfile didn't trigger any panics...` and
  the exit code `2` is returned then it could be the particular crashfile was not the cause
  of the panic.
  The issue could be

- `warning: This version of LLDB has no plugin for the language "rust". Inspection of frame variables will be limited.`.
  I cannot find a way to install `rust-lldb` that could hep here or find another solution for this kind of problem.
