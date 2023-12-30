# validator-bonds

Mono repository for Validator Bonds product

## Repository structure

* [`programs/validator-bonds`](./programs/validator-bonds/) - Anchor on-chain contract project 
* [`packages/`](./packages/) - TypeScript packages related to on-chain program
  ([SDK](./packages/validator-bonds-sdk/), [CLI](./packages/validator-bonds-cli/))

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
anchor build --verifiable

# deploy
solana program deploy -v -ud \
   --program-id vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4 \
   -k [fee-payer-keypair]
   --upgrade-authority [path-to-keypair] \
   ./target/verifiable/validator_bonds.so

# upgrade with SPL Gov authority (generic MNDE realm upgrade authority, governance 7iUtT...wtBZY)
solana -ud program write-buffer target/verifiable/validator_bonds.so
solana program set-buffer-authority --new-buffer-authority 6YAju4nd4t7kyuHV6NvVpMepMk11DgWyYjKVJUak2EEm <BUFFER_PUBKEY>

# publish IDL (account Du3XrzTNqhLt9gpui9LUogrLqCDrVC2HrtiNXHSJM58y)
anchor --provider.cluster devnet idl \
  # init vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4 \
  upgrade vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4 \
  -f ./target/idl/validator_bonds.json

# check verifiable deployment (<BUFFER_PUBKEY> can be verified as well)
anchor --provider.cluster devnet \
 verify -p validator_bonds \
 vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4
```

// TODO: add table of authorities - what state means what authority
// TODO: add flow diagram how calls will be done