#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, n/no-process-exit */
import { BorshAccountsCoder } from '@coral-xyz/anchor'
import {
  bondProductAddress,
  ProductTypes,
  VALIDATOR_BONDS_PROGRAM_ID,
  validateCommissionProductArgs,
  MARINADE_CONFIG_ADDRESS,
  bondAddress,
  getBond,
  getProgram,
} from '@marinade.finance/validator-bonds-sdk'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import BN from 'bn.js'
import { Command, Option } from 'commander'

import * as ValidatorBondsIDL from '../../../packages/validator-bonds-sdk/idl/json/validator_bonds.json'

import type { ProductType } from '@marinade.finance/validator-bonds-sdk'

type OutputFormat = 'base64' | 'hex' | 'numbers' | 'all'

function formatBuffer(
  buffer: Buffer,
  format: OutputFormat,
): { base64?: string; hex?: string; numbers?: string } {
  switch (format) {
    case 'base64':
      return { base64: buffer.toString('base64') }
    case 'hex':
      return { hex: buffer.toString('hex') }
    case 'numbers':
      return { numbers: `[${Array.from(buffer).join(',')}]` }
    case 'all':
      return {
        base64: buffer.toString('base64'),
        hex: buffer.toString('hex'),
        numbers: `[${Array.from(buffer).join(',')}]`,
      }
    default:
      throw new Error(`Unsupported format: ${String(format)}`)
  }
}

async function generateBondProductData({
  config,
  bond,
  voteAccount,
  bump,
  productType,
  inflationBps,
  mevBps,
  blockBps,
  format,
}: {
  config: PublicKey
  bond: PublicKey
  voteAccount: PublicKey
  inflationBps: number | null
  mevBps: number | null
  blockBps: number | null
  bump: number
  productType: ProductType
  format: OutputFormat
}): Promise<{ base64?: string; hex?: string; numbers?: string }> {
  const commissionConfig = {
    inflationBps: inflationBps !== null ? new BN(inflationBps) : null,
    mevBps: mevBps !== null ? new BN(mevBps) : null,
    blockBps: blockBps !== null ? new BN(blockBps) : null,
  }

  validateCommissionProductArgs(commissionConfig)

  // Note: BorshAccountsCoder expects field names to match the JSON IDL exactly:
  // - Struct fields use snake_case (vote_account, not voteAccount)
  // - Enum variant names use PascalCase (Commission, not commission)
  // - Enum variants with fields need to be wrapped in an array
  const bondProductData = {
    config,
    bond,
    vote_account: voteAccount,
    product_type: ProductTypes.rustEnumType(productType),
    config_data: {
      Commission: [
        {
          inflation_bps: inflationBps !== null ? new BN(inflationBps) : null,
          mev_bps: mevBps !== null ? new BN(mevBps) : null,
          block_bps: blockBps !== null ? new BN(blockBps) : null,
        },
      ],
    },
    bump,
  }

  // Encode the account using Anchor's BorshAccountsCoder
  const coder = new BorshAccountsCoder(ValidatorBondsIDL as any)
  const accountBuffer = await coder.encode('BondProduct', bondProductData)

  return formatBuffer(accountBuffer, format)
}

// CLI setup
const program = new Command()

program
  .name('bond-product-data-generator')
  .description(
    'Generate BondProduct account data for Solana Anchor in various formats',
  )
  .version('1.0.0')
  .addOption(
    new Option(
      '-u, --url <rpc-url>',
      'solana RPC URL or a moniker ' +
        '(m/mainnet/mainnet-beta, d/devnet, t/testnet, l/localhost), see https://solana.com/rpc',
    )
      .default('mainnet')
      .env('RPC_URL'),
  )
  .option('--inflation <bps>', 'Inflation commission in basis points', val =>
    parseInt(val, 10),
  )
  .option('--mev <bps>', 'MEV commission in basis points', val =>
    parseInt(val, 10),
  )
  .option('--block <bps>', 'Block commission in basis points', val =>
    parseInt(val, 10),
  )
  .option(
    '--config <pubkey>',
    'Config pubkey',
    MARINADE_CONFIG_ADDRESS.toBase58(),
  )
  .option('--bond <pubkey>', 'Bond pubkey')
  .option('--vote-account <pubkey>', 'Vote account pubkey')
  .addOption(
    new Option('-f, --format <format>', 'Output format for the encoded data')
      .choices(['base64', 'hex', 'numbers', 'all'])
      .default('hex'),
  )
  .option(
    '-s, --silent',
    'Silent mode - only print formatted data without config information',
    false,
  )
  .action(async (options, command) => {
    try {
      if (!options.bond && !options.voteAccount) {
        command.help()
      }

      const inflationBps =
        options.inflation !== undefined ? Number(options.inflation) : null
      const mevBps = options.mev !== undefined ? Number(options.mev) : null
      const blockBps =
        options.block !== undefined ? Number(options.block) : null

      let bond: PublicKey
      let voteAccount: PublicKey
      const config = new PublicKey(options.config)

      if (options.bond && options.voteAccount) {
        console.log(
          `CLI defined bond and vote account. Using vote account ${options.voteAccount} as the source of truth.`,
        )
      }
      if (options.voteAccount) {
        voteAccount = new PublicKey(options.voteAccount)
        const [bondPubkey] = bondAddress(
          config,
          voteAccount,
          VALIDATOR_BONDS_PROGRAM_ID,
        )
        bond = bondPubkey
      } else if (options.bond && !options.voteAccount) {
        if (!options.bond) {
          throw new Error(
            'Bond pubkey or RPC_URL/--url is required if vote account is not set',
          )
        }
        bond = new PublicKey(options.bond)
        const connection = new Connection(options.url)
        const program = getProgram({ connection, wallet: Keypair.generate() })
        const bondData = await getBond(program, bond)
        voteAccount = bondData.voteAccount
      } else {
        throw new Error('Either bond or vote account must be provided')
      }

      const productType = ProductTypes.commission
      const [bondProductPda, calculatedBump] = bondProductAddress(
        bond,
        productType,
        VALIDATOR_BONDS_PROGRAM_ID,
      )

      const format = options.format as OutputFormat
      const silent = options.silent as boolean

      const encodedData = await generateBondProductData({
        config,
        bond,
        voteAccount,
        inflationBps,
        mevBps,
        blockBps,
        bump: calculatedBump,
        productType,
        format,
      })

      if (silent) {
        // Silent mode: only print the formatted data
        console.log(Object.values(encodedData).join('\n'))
      } else {
        const formatName = format.charAt(0).toUpperCase() + format.slice(1)
        console.log(
          `${formatName}-encoded BondProduct account data [${bondProductPda.toBase58()}]:`,
        )
        console.log(encodedData)

        console.log('\nParameters:')
        console.log(`  BondProduct Pubkey: ${bondProductPda.toBase58()}`)
        console.log(`  Config: ${config.toBase58()}`)
        console.log(`  Bond: ${bond.toBase58()}`)
        console.log(`  Vote Account: ${voteAccount.toBase58()}`)
        console.log(`  Inflation BPS: ${inflationBps ?? 'None'}`)
        console.log(`  MEV BPS: ${mevBps ?? 'None'}`)
        console.log(`  Block BPS: ${blockBps ?? 'None'}`)
        console.log(`  PDA bump: ${calculatedBump}`)
      }
    } catch (error) {
      console.error('Error generating data:', error)
      process.exit(1)
    }
  })

try {
  program.parse(process.argv)
} catch (err) {
  console.error('CLI Error:', err)
  process.exit(1)
}
