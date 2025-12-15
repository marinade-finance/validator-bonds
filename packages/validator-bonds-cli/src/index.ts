#!/usr/bin/env node

import 'reflect-metadata'

import {
  launchCliProgram,
  CliType,
} from '@marinade.finance/validator-bonds-cli-core'
import { VALIDATOR_BONDS_PROGRAM_ID } from '@marinade.finance/validator-bonds-sdk'
import { parsePubkey } from '@marinade.finance/web3js-1x'

import { installCommands } from './commands'

export const VALIDATOR_BONDS_NPM_URL =
  'https://registry.npmjs.org/@marinade.finance/validator-bonds-cli'

launchCliProgram({
  version: '2.3.0',
  installAdditionalOptions: program => {
    program.option(
      '--program-id <pubkey>',
      `Program id of validator bonds contract (default: ${VALIDATOR_BONDS_PROGRAM_ID.toBase58()})`,
      parsePubkey,
      Promise.resolve(VALIDATOR_BONDS_PROGRAM_ID),
    )
  },
  installSubcommands: program => {
    installCommands(program)
  },
  npmRegistryUrl: VALIDATOR_BONDS_NPM_URL,
  announcementsConfig: {
    enabled: true,
    cliType: CliType.Sam,
  },
})
