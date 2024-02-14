 validator-bonds

Mono repository for Validator Bonds product

## Repository structure

* [`programs/validator-bonds`](./programs/validator-bonds/) - Anchor on-chain contract project 
* [`packages/`](./packages/) - TypeScript packages related to on-chain program
  ([SDK](./packages/validator-bonds-sdk/), [CLI](./packages/validator-bonds-cli/))

## CLI usage from source

To run the CLI you need to have installed Node.js in version 16+ and `pnpm`.
For details on CLI options see [validator-bonds-cli README](./packages/validator-bonds-cli/README.md).

```sh
# installing TS dependencies
pnpm install
# run CLI
pnpm cli --help
```

## Development

### On-Chain related parts

To build the Anchor program use the [`scripts`](./package.json) of the `pnpm`.

```sh
# install TS dependencies
pnpm install

# building Anchor program + cli and sdk TS packages
pnpm build

# testing the SDK+CLI against the bankrun and local validator
pnpm test
# bankrun part of the tests
pnpm test:bankrun
# local validator part of the tests
pnpm test:validator
# cargo tests in rust code
pnpm test:cargo
```

### Contract deployment

```sh
anchor build --verifiable \
  --env "GIT_REV=`git rev-parse --short HEAD`" --env 'GIT_REV_NAME=<SOME_VERSION>'

# 1. DEPLOY
## deploy (devnet, hot wallet upgrade)
solana program deploy -v -ud \
   --program-id vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4 \
   -k [fee-payer-keypair]
   --upgrade-authority [path-to-keypair] \
   ./target/verifiable/validator_bonds.so

# deploy (mainnet, SPL Gov authority multisig, governance 7iUtT...wtBZY)
solana -um -k [fee-payer-keypair] \
    program write-buffer target/verifiable/validator_bonds.so
solana -um -k [fee-payer-keypair] \
    program set-buffer-authority \
    --new-buffer-authority 6YAju4nd4t7kyuHV6NvVpMepMk11DgWyYjKVJUak2EEm <BUFFER_PUBKEY>


# 2. IDL UPDATE, idl account Du3XrzTNqhLt9gpui9LUogrLqCDrVC2HrtiNXHSJM58y)
## publish IDL (devnet, hot wallet)
anchor --provider.cluster devnet idl \
  --provider.wallet [fee-payer-keypair] \
  # init vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4 \
  upgrade vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4 \
  -f ./target/idl/validator_bonds.json

## publish IDL (mainnet, spl gov)
anchor idl write-buffer --provider.cluster mainnet --provider.wallet [fee-payer-keypair] \
  --filepath target/idl/validator_bonds.json vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4
anchor idl set-authority --provider.cluster mainnet --provider.wallet [fee-payer-keypair] \
  --new-authority 6YAju4nd4t7kyuHV6NvVpMepMk11DgWyYjKVJUak2EEm --program-id vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4 \
  <BUFFER_PUBKEY>



# 3.check verifiable deployment (<BUFFER_PUBKEY> can be verified as well)
#   a) when the target/verifiable/.so has been built already use switch --skip-build
anchor --provider.cluster mainnet \
   verify -p validator_bonds \
   --env "GIT_REV=`git rev-parse --short HEAD`" --env 'GIT_REV_NAME=v1.1.0' \
   <PROGRAM_ID_or_BUFFER_ID>

```

## TODO

* add table of authorities - what state means what authority
* add flow diagram how calls will be done
