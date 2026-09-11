#!/usr/bin/env node

import { CLIContext } from '@marinade.finance/cli-common'
import {
  ErrorWithCause,
  pinoConfiguration,
  setContext,
} from '@marinade.finance/ts-common'
import { Command } from 'commander'
import pino from 'pino'

import { installCommands } from './commands'

export const logger = pino(pinoConfiguration('info'), pino.destination())
logger.level = 'debug'
const program = new Command()

program
  .version('0.0.1')
  .allowExcessArguments(false)
  .configureHelp({ showGlobalOptions: true })
  .option(
    '-d, --debug',
    'Printing more detailed information of the CLI execution',
    false,
  )
  .option('-v, --verbose', 'alias for --debug', false)
  .hook('preAction', (command: Command, action: Command) => {
    if (command.opts().debug || command.opts().verbose) {
      logger.level = 'debug'
    } else {
      logger.level = 'info' // default level
    }

    setContext(
      new CLIContext({
        logger,
        commandName: action.name(),
      }),
    )
  })

installCommands(program)

program.parseAsync(process.argv).then(
  () => {
    logger.debug({ resolution: 'Success', args: process.argv })
  },
  (err: unknown) => {
    logger.error(
      err instanceof ErrorWithCause
        ? err.messageWithCause()
        : err instanceof Error
          ? err.message
          : String(err),
    )
    logger.debug({ resolution: 'Failure', err, args: process.argv })
    process.exitCode = 200
  },
)
