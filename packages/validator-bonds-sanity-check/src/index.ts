#!/usr/bin/env node

import { pinoConfiguration } from '@marinade.finance/ts-common'
import { Command } from 'commander'
import pino from 'pino'
import 'reflect-metadata'

import { installCommands } from './commands'
import { SanityCheckCLIContext as Context } from './context'

export const logger = pino(pinoConfiguration('info'), pino.destination())
logger.level = 'debug'
const program = new Command()

program
  .version('1.0.0')
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

    Context.define({
      logger,
      commandName: action.name(),
    })
  })

installCommands(program)

program.parseAsync(process.argv).then(
  () => {
    logger.debug({ resolution: 'Success', args: process.argv })
  },
  (err: Error) => {
    logger.error(err.message)
    logger.debug({ resolution: 'Failure', err, args: process.argv })
    process.exitCode = 200
  },
)
