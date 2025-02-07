# Codama TypeScript Client Generator

Generating TypeScript client from Bonds contract IDL with
[Codama generator library](https://github.com/codama-idl/codama).

For some details check [QuickNode blogpost](https://www.quicknode.com/guides/solana-development/tooling/web3-2/program-clientshttps://www.quicknode.com/guides/solana-development/tooling/web3-2/program-clients)

## HOWTO

1. Verify IDL content of [`validator_bonds.json`](../../resources/idl/validator_bonds.json)
2. Generate TS client with

```sh
cd scripts/codama-generator
pnpm install
pnpm generate
```

3. Check client changes in package [`validator-bonds-codama`](../../packages/validator-bonds-codama)