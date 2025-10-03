#!/usr/bin/env node

/* eslint-disable @typescript-eslint/no-unsafe-assignment */

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
  .requiredOption(
    '-c, --current <path>',
    'Input file of validator bonds settlement (JSON)',
  )
  .option(
    '-d, --debug',
    'Printing more detailed information of the CLI execution',
    false,
  )
  .option('-v, --verbose', 'alias for --debug', false)
  .hook('preAction', async (command: Command, action: Command) => {
    if (command.opts().debug || command.opts().verbose) {
      logger.level = 'debug'
    } else {
      logger.level = 'info' // default level
    }

    await Context.define({
      logger,
      commandName: action.name(),
      currentPath: command.opts().current,
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
