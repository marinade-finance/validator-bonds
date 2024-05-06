# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.


## TS CLI&SDK [1.3.4](https://github.com/marinade-finance/validator-bonds/compare/v1.3.3...v1.3.4) (2024-05-06)

### Fixes

* CLI: fixing withdraw claim command that was wrongly filtering stake accounts possible for claiming


## TS CLI&SDK [1.3.3](https://github.com/marinade-finance/validator-bonds/compare/v1.3.2...v1.3.3) (2024-04-26)

### Fixes

* CLI show uses term `number`for providing info on count of arguments
* bond related commands uses bond and vote account addresses

## TS CLI&SDK [1.3.2](https://github.com/marinade-finance/validator-bonds/compare/v1.3.1...v1.3.2) (2024-04-15)

### Fixes

* CLI help to show global options for subcommands as well

## TS CLI&SDK [1.3.1](https://github.com/marinade-finance/validator-bonds/compare/v1.3.0...v1.3.1) (2024-04-15)

### Fixes

* CLI show-bond to not querying `getEpochInfo` for every loaded stake account,
  mitigating error `Server responded with 429 Too Many Requests`

## TS CLI&SDK [1.3.0](https://github.com/marinade-finance/validator-bonds/compare/v1.2.2...v1.3.0) (2024-04-12)

### Updates

CLI and SDK aligned with contract release v1.4.0

### CLI Features

* `cancel-settlement` command was added

### Fixes

* CLI considers solana config file when loading keypair


## contract release v1.4.0 (2024-04-12)

* address: [`vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4`](https://explorer.solana.com/address/vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4)
* tag: [`contract-v1.4.0`](https://github.com/marinade-finance/validator-bonds/releases/tag/contract-v1.4.0), commit: [`7e6d35e`](https://github.com/marinade-finance/validator-bonds/commit/7e6d35e8337174bfe6fcf2691914ac65427f6095),
* tx: [`BmsU9Zdjt1dPrRckvNknz9kUYQZVFKKWW91nFAoDPAWfEsuSVpZm7EQi6UD4dFJpKLXF4nGYEy6Z69c43qpApgx`](https://explorer.solana.com/tx/BmsU9Zdjt1dPrRckvNknz9kUYQZVFKKWW91nFAoDPAWfEsuSVpZm7EQi6UD4dFJpKLXF4nGYEy6Z69c43qpApgx)
* anchor verify command:
  ```
  git checkout 7e6d35e &&\
  anchor verify  --provider.cluster mainnet -p validator_bonds \
    --env "GIT_REV=`git rev-parse --short HEAD`" --env 'GIT_REV_NAME=v1.4.0' vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4
  ```


## TS CLI&SDK [1.2.1+1.2.2](https://github.com/marinade-finance/validator-bonds/compare/v1.2.0...v1.2.2) (2024-04-09)

### Fixes

* README updates
* bumps of library dependencies
* cli `show-config` to display bonds-withdrawer-authority calculated PDA


## TS CLI&SDK [1.2.0](https://github.com/marinade-finance/validator-bonds/compare/v1.1.12...v1.2.0) (2024-03-19)

### Updates

CLI and SDK aligned with contract release v1.3.0

### CLI Features

* `init-withdraw-request`, `cancel-withdraw-request`, `claim-withdraw-request` commands were added to work with funding and withdrawing stake accounts to Bonds Program
* `mint-bond` command were added to make possible to configure the bond account without signing CLI with validator identity
* `configure-bond` command adjusted to work with `mint-bond` SPL tokens
* `show-bond` adjusted to show funded amounts
* `pause`, `resume` commands for emergency purposes added

### Fixes

* on execution the error `Server responded with 429 Too Many Requests.  Retrying after 1000ms delay...` should not be failing the commands anymore


## contract release v1.3.0 (2024-03-08)

* address: [`vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4`](https://explorer.solana.com/address/vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4)
* tag: [`contract-v1.3.0`](https://github.com/marinade-finance/validator-bonds/releases/tag/contract-v1.3.0), commit: [`776b1b7`](https://github.com/marinade-finance/validator-bonds/commit/776b1b7d76ccee204e938cd6572e4c40281146d4),
* tx: [`4a6LZFT1CzBSpCGY6SUcw1MPwxKVXt7h2Z4J21MSrH5uKmXnNmXQtMzpJt4oPTKbjXDGzpZyHrAUMxsHkUAESDSK`](https://explorer.solana.com/tx/4a6LZFT1CzBSpCGY6SUcw1MPwxKVXt7h2Z4J21MSrH5uKmXnNmXQtMzpJt4oPTKbjXDGzpZyHrAUMxsHkUAESDSK)
* anchor verify command:
  ```
  git checkout 776b1b7 &&\
  anchor verify  --provider.cluster mainnet -p validator_bonds \
    --env "GIT_REV=`git rev-parse --short HEAD`" --env 'GIT_REV_NAME=v1.3.0' vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4
  ```

## TS CLI&SDK [1.1.12](https://github.com/marinade-finance/validator-bonds/compare/v1.1.11...v1.1.12) (2024-02-19)

### Features

* `show-bond` command accepts vote account address, not only the bond account address

## TS CLI&SDK [1.1.11](https://github.com/marinade-finance/validator-bonds/compare/v1.1.10...v1.1.11) (2024-02-15)

### Fixes

* moved to work with contract update v1.2.0

### Features

* `show-bond` command is capable to list more bond records than before (still limited by `getProgramAccounts` RPC call)

## contract release v1.2.0 (2024-02-15)

* address: [`vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4`](https://explorer.solana.com/address/vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4)
* tag: [`contract-v1.2.0`](https://github.com/marinade-finance/validator-bonds/releases/tag/contract-v1.2.0), commit: [`7be11c7`](https://github.com/marinade-finance/validator-bonds/commit/7be11c7), 
* tx: [`2D4JnDLZ7wuD41gzdMNYGc9Rya9AFR6XTZqhDxQGPq3bLY7WazadLHpH8AjFnZ6HtF6T4jLpGoqEd574Ecjb73hY`](https://explorer.solana.com/tx/2D4JnDLZ7wuD41gzdMNYGc9Rya9AFR6XTZqhDxQGPq3bLY7WazadLHpH8AjFnZ6HtF6T4jLpGoqEd574Ecjb73hY)
* anchor verify command:
  ```
  git checkout 7be11c7 &&\
  anchor verify  --provider.cluster mainnet -p validator_bonds \
    --env "GIT_REV=`git rev-parse --short HEAD`" --env 'GIT_REV_NAME=v1.2.0' vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4
  ```

## TS CLI&SDK [1.1.10](https://github.com/marinade-finance/validator-bonds/compare/v1.1.8...v1.1.10) (2024-02-04)

### Features

* allow init-bond to be used without validator identity signature, aligning with contract v1.1.0 update

## contract release v1.1.0 (2024-02-04)

* address: [`vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4`](https://explorer.solana.com/address/vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4)
* tag: [`284f060`](https://github.com/marinade-finance/validator-bonds/commit/284f060)
* tx: [`4o894JcxJJQcq9HXnfdrBKfydvgfxdXqgnbvGPK6vEoZeGXfeURunFBvhKEtBr7zrCjN5LYXrxXkvKSsdzUHTD1n`](https://explorer.solana.com/tx/4o894JcxJJQcq9HXnfdrBKfydvgfxdXqgnbvGPK6vEoZeGXfeURunFBvhKEtBr7zrCjN5LYXrxXkvKSsdzUHTD1n)
* anchor verify command:
  ```
  git checkout 284f060 &&\
  anchor verify  --provider.cluster mainnet -p validator_bonds --env "GIT_REV=`git rev-parse --short HEAD`" --env 'GIT_REV_NAME=v1.1.0'`
  ```

## TS CLI&SDK [1.1.8](https://github.com/marinade-finance/validator-bonds/compare/v1.1.7...v1.1.8) (2024-01-30)

### Fixes

* pubkeys arguments to accept keypair or wallet and take the pubkey part from it

## TS CLI&SDK [1.1.7](https://github.com/marinade-finance/validator-bonds/compare/v1.1.4...v1.1.7) (2024-01-27)

### Fixes

* CLI works better on confirming sent transactions

## TS CLI&SDK [1.1.4](https://github.com/marinade-finance/validator-bonds/compare/v1.1.3...v1.1.4) (2024-01-15)

### Fixes

* CLI does not require `--keypair` path to exist when `show-*` command or `--print-only` is used


## TS CLI&SDK [1.1.3](https://github.com/marinade-finance/validator-bonds/compare/v1.1.1...v1.1.3) (2024-01-12)

### Features

* adding create, cancel, withdraw request SDK functions

## validator-bonds contract release (2024-01-12)

* address: [`vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4`](https://explorer.solana.com/address/vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4)
* tag: [`16aec25`](https://github.com/marinade-finance/validator-bonds/commit/16aec2510a1d199c5d48458d77e09e45908a5944)
* tx: [`5WseNRgBgqQD2eZD6z4S8aFhPUWX741tiYGTnheENZ34SisH2rZVzsBotnVj52oTBxwCr5wSYqxog8FLMeXGrg58`](https://explorer.solana.com/tx/5WseNRgBgqQD2eZD6z4S8aFhPUWX741tiYGTnheENZ34SisH2rZVzsBotnVj52oTBxwCr5wSYqxog8FLMeXGrg58)


## TS CLI&SDK [1.1.1](https://github.com/marinade-finance/validator-bonds/compare/v1.1.0...v1.1.1) (2024-01-05)

### Features

* support for ledger in CLI
* adding fund bond CLI command

## validator-bonds contract release (2024-01-03)

* address: [`vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4`](https://explorer.solana.com/address/vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4)
* tag: [`33a5004`](https://github.com/marinade-finance/validator-bonds/commit/597ef8c9edac9c1ac02c533be7cbae937fceed1a)
* tx: [`5uSwyCpQe3zniVRU6sdbWdaoiLNoiAf9TggqhNRe7BsUN2hxquwWhERTd2jBcMVScmAgYNgA9keVxJ1qf6hnwJvf`](https://explorer.solana.com/tx/5uSwyCpQe3zniVRU6sdbWdaoiLNoiAf9TggqhNRe7BsUN2hxquwWhERTd2jBcMVScmAgYNgA9keVxJ1qf6hnwJvf)


## TS CLI&SDK [1.1.0](https://github.com/marinade-finance/validator-bonds/compare/cli_v1.0.3...v1.1.0) (2024-01-03)

### Features

* bond will be now created with validator identity signature instead of vote account withdrawer

### Fixes

* readme published to npm registry
* CLI fixing nodejs bin installation
* fixing `--keypair` argument being parsed correctly

## TS CLI&SDK [1.0.3](https://github.com/marinade-finance/validator-bonds/compare/v1.0.0...cli_v1.0.3) (2024-01-02)

### Fixes

* readme published to npm registry
* CLI fixing nodejs bin installation
* fixing `--keypair` argument being parsed correctly


## TS CLI&SDK [1.0.0](https://github.com/marinade-finance/validator-bonds/compare/v1.0.0) (2023-12-31)

### Features

* SDK and CLI with init, configure and show `Config` and `Bond` accounts
