/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */

import { pinoConfiguration } from '@marinade.finance/ts-common'
import {
  DEFAULT_KEYPAIR_PATH,
  ExecutionError,
  parseWalletFromOpts,
} from '@marinade.finance/web3js-1x'
import { Command, Option } from 'commander'
import pino from 'pino'

import { setValidatorBondsCliContext } from '../context'
import {
  compareVersions,
  fetchLatestVersionInNpmRegistry,
} from '../npmRegistry'

export function launchCliProgram({
  version,
  installAdditionalOptions,
  installSubcommands,
  npmRegistryUrl,
}: {
  version: string
  installAdditionalOptions: (program: Command) => void
  installSubcommands: (program: Command) => void
  npmRegistryUrl: string
}) {
  const logger = pino(pinoConfiguration('info'), pino.destination())
  logger.level = 'debug'
  const program = new Command()

  program
    .version(version)
    .allowExcessArguments(false)
    .configureHelp({ showGlobalOptions: true })
    .addOption(
      new Option(
        '-u, --url <rpc-url>',
        'solana RPC URL or a moniker ' +
          '(m/mainnet/mainnet-beta, d/devnet, t/testnet, l/localhost), see https://solana.com/rpc',
      )
        .default('mainnet')
        .env('RPC_URL'),
    )
    .option('-c, --cluster <cluster>', 'alias for "-u, --url"')
    .option(
      '-k, --keypair <keypair-or-ledger>',
      'Wallet keypair (path or ledger url in format usb://ledger/[<pubkey>][?key=<derivedPath>]). ' +
        'Wallet keypair is used to pay for the transaction fees and as default value for signers. ' +
        `(default: loaded from solana config file or ${DEFAULT_KEYPAIR_PATH})`,
    )
    .option('-s, --simulate', 'Simulate', false)
    .option(
      '-p, --print-only',
      'Print only mode, no execution, instructions are printed in base64 to output. ' +
        'This can be used for placing the admin commands to SPL Governance UI by hand.',
      false,
    )
    .option(
      '--skip-preflight',
      'Transaction execution flag "skip-preflight", see https://solanacookbook.com/guides/retrying-transactions.html#the-cost-of-skipping-preflight',
      false,
    )
    .option('--commitment <commitment>', 'Commitment', 'confirmed')
    .option(
      '--confirmation-finality <confirmed|finalized>',
      'Confirmation finality of sent transaction. ' +
        'Default is "confirmed" that means for majority of nodes confirms in cluster. ' +
        '"finalized" stands for full cluster finality that takes ~8 seconds.',
      'confirmed',
    )
    .option(
      '--with-compute-unit-price <compute-unit-price>',
      'Set compute unit price for transaction, in increments of 0.000001 lamports per compute unit.',
      v => parseInt(v, 10),
      10,
    )
    .option(
      '-d, --debug',
      'Printing more detailed information of the CLI execution',
      false,
    )
    .option('-v, --verbose', 'alias for --debug', false)

  installAdditionalOptions(program)

  program.hook('preAction', async (command: Command, action: Command) => {
    if (command.opts().debug || command.opts().verbose) {
      logger.level = 'debug'
    } else {
      logger.level = 'info' // Default level
    }

    const printOnly = Boolean(command.opts().printOnly)
    const walletInterface = await parseWalletFromOpts(
      command.opts().keypair,
      printOnly,
      command.args,
      logger,
    )

    const programId = await command.opts().programId
    if (!programId) {
      throw new Error('CLI Program ID parameter is not set')
    }

    setValidatorBondsCliContext({
      cluster: (command.opts().url ?? command.opts().cluster) as string,
      wallet: walletInterface,
      programId,
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

  installSubcommands(program)

  program.parseAsync(process.argv).then(
    () => {
      logger.debug({ resolution: 'Success', args: process.argv })
      logger.flush()
    },
    (err: Error) => {
      logger.error(
        err instanceof ExecutionError
          ? err.messageWithTransactionError()
          : err.message,
      )
      logger.debug({
        resolution: 'Failure',
        err,
        error_stack:
          err instanceof Error ? JSON.stringify(err.stack, null, 2) : undefined,
        args: process.argv,
      })

      // Check for the latest version to inform user to update
      fetchLatestVersionInNpmRegistry(logger, npmRegistryUrl)
        .then(npmData => {
          if (
            compareVersions(program.version() ?? '0.0.0', npmData.version) < 0
          ) {
            logger.error(
              `CLI version ${program.version()} is lower than the latest available version: ${npmData.version}. Please consider updating it:\n` +
                `  npm install -g ${npmData.name}@latest\n`,
            )
          }
        })
        .catch(err => {
          logger.debug(`Failed to check the latest version: ${err}`)
        })

      logger.flush()
      process.exitCode = 200
    },
  )
}
