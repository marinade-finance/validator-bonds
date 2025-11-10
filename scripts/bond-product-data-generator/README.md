# Bond Product Data Generator

A CLI tool to generate hex-encoded BondProduct account data for Solana Anchor programs.
The hex data can be used to force push account to Surfpool for testing purposes
(see [bonds-collector README](../../bonds-collector/README.md)).

See [Anchor Program BondProduct](../../programs/validator-bonds/src/state/bond_product.rs).

## Installation

```bash
pnpm install
```

## Usage

### Run

```bash
pnpm generate generate --inflation 500 --mev 1000 --block 750
```

## Command Line Options

- `--inflation <bps>` - Inflation commission in basis points (optional, 0-10000)
- `--mev <bps>` - MEV commission in basis points (optional, 0-10000)
- `--block <bps>` - Block commission in basis points (optional, 0-10000)
- `--config <pubkey>` - Config pubkey (optional, defaults to system program)
- `--bond <pubkey>` - Bond pubkey (optional, defaults to system program)
- `--vote-account <pubkey>` - Vote account pubkey (optional, defaults to system program)
- `--bump <value>` - Bump seed (optional, defaults to 255)
