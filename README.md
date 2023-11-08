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

# testing the SDK+CLI against the local validator running the program
pnpm test
```
