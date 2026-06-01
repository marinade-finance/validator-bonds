/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */

import { randomUUID } from 'node:crypto'

import { pinoConfiguration } from '@marinade.finance/ts-common'
import {
  DEFAULT_KEYPAIR_PATH,
  ExecutionError,
  parseWalletFromOpts,
} from '@marinade.finance/web3js-1x'
import { PublicKey } from '@solana/web3.js'
import { Command, Option } from 'commander'
import pino from 'pino'

import { printNotificationBanners } from '../banner'
import {
  DEFAULT_MIX_PROXY_URL,
  clusterLabel,
  drainTxData,
  errorClass,
  getOrCreateInstallId,
  getProgramTelemetryFields,
  isTelemetryDisabled,
  recordCliCommand,
  recordCliCommandComplete,
} from '../cliUsage'
import { getCliContext, setValidatorBondsCliContext } from '../context'
import { translateKnownError } from '../errorTranslators'
import { startFetchingNotificationBanners } from '../notifications'
import { requireLatestCliVersion } from '../npmRegistry'

import type {
  CliUsageConfig,
  CompletionResult,
  PendingCompletion,
} from '../cliUsage'
import type { NotificationsConfig } from '../notifications'

export const DEFAULT_NOTIFICATIONS_API_URL =
  'https://marinade-notifications.marinade.finance'

export function launchCliProgram({
  version,
  installAdditionalOptions,
  installSubcommands,
  npmRegistryUrl,
  notificationsConfig,
  cliUsageConfig,
}: {
  version: string
  installAdditionalOptions: (program: Command) => void
  installSubcommands: (program: Command) => void
  npmRegistryUrl: string
  notificationsConfig?: NotificationsConfig
  cliUsageConfig?: CliUsageConfig
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
    .addOption(
      new Option(
        '--notifications-api-url <url>',
        'Override notifications API URL',
      )
        .env('NOTIFICATIONS_API_URL')
        .default(DEFAULT_NOTIFICATIONS_API_URL)
        .hideHelp(),
    )
    .addOption(
      new Option('--mix-proxy-url <url>', 'Override Mixpanel proxy URL')
        .env('MIX_PROXY_URL')
        .default(DEFAULT_MIX_PROXY_URL)
        .hideHelp(),
    )

  installAdditionalOptions(program)

  let pendingCompletion: PendingCompletion | undefined

  program.hook('preAction', async (command: Command, action: Command) => {
    const verbose = command.opts().debug || command.opts().verbose
    if (verbose) {
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
    const commandName = action.name()

    const notificationsApiUrl = command.opts().notificationsApiUrl as string
    const mixProxyUrl = command.opts().mixProxyUrl as string
    const cluster = (command.opts().url ?? command.opts().cluster) as string
    const simulate = Boolean(command.opts().simulate)

    if (notificationsConfig?.enabled) {
      startFetchingNotificationBanners(
        {
          notificationType: notificationsConfig.notificationType,
          apiUrl: notificationsApiUrl,
        },
        logger,
      )
    }

    if (cliUsageConfig?.enabled && !isTelemetryDisabled()) {
      // Argument parsers like parsePubkey return Promise<PublicKey>; unwrap so
      // we inspect the resolved value, not the pending Promise.
      const arg = await Promise.resolve(action.processedArgs?.[0]).catch(
        () => undefined,
      )
      const account = arg instanceof PublicKey ? arg.toBase58() : undefined
      const { accountField } = getProgramTelemetryFields(action)
      const walletPubkey = walletInterface.publicKey?.toBase58()
      const installId = getOrCreateInstallId(logger)
      const sessionId = randomUUID()
      pendingCompletion = {
        mixProxyUrl,
        cliType: cliUsageConfig.cliType,
        cliVersion: version,
        operation: commandName,
        sessionId,
        walletPubkey,
        installId,
        cluster: clusterLabel(cluster),
        simulate,
        printOnly,
        startedAt: Date.now(),
      }
      void recordCliCommand(
        { ...pendingCompletion, account, accountField },
        logger,
      )
    }

    setValidatorBondsCliContext({
      cluster,
      wallet: walletInterface,
      simulate,
      printOnly,
      skipPreflight: Boolean(command.opts().skipPreflight),
      commitment: command.opts().commitment,
      confirmationFinality: command.opts().confirmationFinality,
      computeUnitPrice: command.opts().withComputeUnitPrice,
      logger,
      verbose,
      command: commandName,
      notificationsApiUrl,
      notificationType: notificationsConfig?.notificationType ?? '',
    })

    await requireLatestCliVersion(logger, npmRegistryUrl, version)
  })

  const fireCompletion = (result: CompletionResult) => {
    if (!pendingCompletion) return
    const drained = drainTxData()
    void recordCliCommandComplete(
      {
        ...pendingCompletion,
        ...drained,
        result,
        durationMs: Date.now() - pendingCompletion.startedAt,
      },
      logger,
    )
  }

  if (notificationsConfig?.enabled) {
    program.hook('postAction', async () => {
      await printNotificationBanners(logger)
    })
  }

  installSubcommands(program)

  program.parseAsync(process.argv).then(
    () => {
      fireCompletion('success')
      logger.debug({ resolution: 'Success', args: process.argv })
      logger.flush()
    },
    (err: Error) => {
      fireCompletion(errorClass(err))
      const originalErr = err
      let rpcEndpoint: string | undefined
      try {
        rpcEndpoint = getCliContext().provider.connection.rpcEndpoint
      } catch (_e) {
        // context not yet set (error happened before preAction completed)
      }
      err = translateKnownError(err, { rpcEndpoint })
      logger.error(
        err instanceof ExecutionError
          ? err.messageWithTransactionError()
          : err.message,
      )
      logger.debug({
        resolution: 'Failure',
        err: originalErr,
        error_stack:
          originalErr instanceof Error
            ? JSON.stringify(originalErr.stack, null, 2)
            : undefined,
        args: process.argv,
      })

      logger.flush()
      process.exitCode = 200
    },
  )
}
