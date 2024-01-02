#!/usr/bin/env node

/* eslint-disable no-process-exit */
import { Command } from 'commander'
import { configureLogger, parsePubkey } from '@marinade.finance/cli-common'
import { installCommands } from './commands'
import { Logger } from 'pino'
import { parseSignerWithLogger, setValidatorBondsCliContext } from './context'
import { VALIDATOR_BONDS_PROGRAM_ID } from '@marinade.finance/validator-bonds-sdk'

const DEFAULT_KEYPAIR_PATH = '~/.config/solana/id.json'
const logger: Logger = configureLogger()
const program = new Command()

program
  .version('0.0.1')
  .allowExcessArguments(false)
  .option(
    '-u, --cluster <cluster>',
    'solana cluster URL, accepts shortcuts (d/devnet, m/mainnet)',
    'http://127.0.0.1:8899'
  )
  .option('-c <cluster>', 'alias for "-u, --cluster"')
  .option('--commitment <commitment>', 'Commitment', 'confirmed')
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
    'transaction execution flag "skip-preflight", see https://solanacookbook.com/guides/retrying-transactions.html#the-cost-of-skipping-preflight',
    false
  )
  .option(
    '-d, --debug',
    'printing more detailed information of the CLI execution',
    false
  )
  .option('-v, --verbose', 'alias for --debug', false)
  .hook('preAction', async (command: Command, action: Command) => {
    const wallet = command.opts().keypair
    const walletInterface = wallet
      ? await parseSignerWithLogger(wallet, logger)
      : await parseSignerWithLogger(DEFAULT_KEYPAIR_PATH, logger)
    if (command.opts().debug || command.opts().verbose) {
      logger.level = 'debug'
    }
    setValidatorBondsCliContext({
      cluster: command.opts().cluster as string,
      wallet: walletInterface,
      programId: await command.opts().programId,
      simulate: Boolean(command.opts().simulate),
      printOnly: Boolean(command.opts().printOnly),
      skipPreflight: Boolean(command.opts().skipPreflight),
      commitment: command.opts().commitment,
      logger,
      command: action.name(),
    })
  })

installCommands(program)

program.parseAsync(process.argv).then(
  () => process.exit(),
  (err: unknown) => {
    logger.error(err)
    process.exit(1)
  }
)
