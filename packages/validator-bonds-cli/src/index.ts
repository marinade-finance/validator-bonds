#!/usr/bin/env node

/* eslint-disable no-process-exit */
import { Command } from 'commander'
import {
  configureLogger,
  parsePubkey,
  parseWalletFromOpts,
} from '@marinade.finance/cli-common'
import { installCommands } from './commands'
import { Logger } from 'pino'
import { setValidatorBondsCliContext } from './context'
import { VALIDATOR_BONDS_PROGRAM_ID } from '@marinade.finance/validator-bonds-sdk'

const DEFAULT_KEYPAIR_PATH = '~/.config/solana/id.json'
export const logger: Logger = configureLogger()
const program = new Command()

program
  .version('1.1.12')
  .allowExcessArguments(false)
  .option(
    '-u, --cluster <cluster>',
    'solana cluster URL or ' +
      'a moniker (m/mainnet/mainnet-beta, d/devnet, t/testnet, l/localhost)',
    'mainnet'
  )
  .option('-c <cluster>', 'alias for "-u, --cluster"')
  .option(
    '-k, --keypair <keypair-or-ledger>',
    'Wallet keypair (path or ledger url in format usb://ledger/[<pubkey>][?key=<derivedPath>]). ' +
      'Wallet keypair is used to pay for the transaction fees and as default value for signers. ' +
      `(default: ${DEFAULT_KEYPAIR_PATH})`
  )
  .option(
    '--program-id <pubkey>',
    `Program id of validator bonds contract (default: ${VALIDATOR_BONDS_PROGRAM_ID})`,
    parsePubkey
  )
  .option('-s, --simulate', 'Simulate', false)
  .option(
    '-p, --print-only',
    'Print only mode, no execution, instructions are printed in base64 to output. ' +
      'This can be used for placing the admin commands to SPL Governance UI by hand.',
    false
  )
  .option(
    '--skip-preflight',
    '|Transaction execution flag "skip-preflight", see https://solanacookbook.com/guides/retrying-transactions.html#the-cost-of-skipping-preflight',
    false
  )
  .option('--commitment <commitment>', 'Commitment', 'confirmed')
  .option(
    '--confirmation-finality <confirmed|finalized>',
    'Confirmation finality of sent transaction. ' +
      'Default is "confirmed" that means for majority of nodes confirms in cluster. ' +
      '"finalized" stands for full cluster finality that takes ~8 seconds.',
    'confirmed'
  )
  .option(
    '--with-compute-unit-price <compute-unit-price>',
    'Set compute unit price for transaction, in increments of 0.000001 lamports per compute unit.',
    parseFloat,
    10
  )
  .option(
    '-d, --debug',
    'Printing more detailed information of the CLI execution',
    false
  )
  .option('-v, --verbose', 'alias for --debug', false)
  .hook('preAction', async (command: Command, action: Command) => {
    if (command.opts().debug || command.opts().verbose) {
      logger.level = 'debug'
    }

    const printOnly = Boolean(command.opts().printOnly)
    const walletInterface = await parseWalletFromOpts(
      command.opts().keypair,
      printOnly,
      command.args,
      logger
    )

    setValidatorBondsCliContext({
      cluster: command.opts().cluster as string,
      wallet: walletInterface,
      programId: await command.opts().programId,
      simulate: Boolean(command.opts().simulate),
      printOnly,
      skipPreflight: Boolean(command.opts().skipPreflight),
      commitment: command.opts().commitment,
      confirmationFinality: command.opts().confirmationFinality,
      computeUnitPrice: command.opts().withComputeUnitPrice,
      logger,
      command: action.name(),
    })
  })

installCommands(program)

program.parseAsync(process.argv).then(
  () => {
    logger.debug({ resolution: 'Success', args: process.argv })
  },
  (err: unknown) => {
    logger.error({ resolution: 'Failure', err, args: process.argv })
    process.exit(200)
  }
)
