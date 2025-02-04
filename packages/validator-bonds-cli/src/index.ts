#!/usr/bin/env node

import { parsePubkey } from '@marinade.finance/cli-common'
import { launchCliProgram } from '@marinade.finance/validator-bonds-cli-core'
import { VALIDATOR_BONDS_PROGRAM_ID } from '@marinade.finance/validator-bonds-sdk'
import { installCommands } from './commands'

export const VALIDATOR_BONDS_NPM_URL =
  'https://registry.npmjs.org/@marinade.finance/validator-bonds-cli'

launchCliProgram({
  version: '2.1.0',
  installAdditionalOptions: program => {
    program.option(
      '--program-id <pubkey>',
      `Program id of validator bonds contract (default: ${VALIDATOR_BONDS_PROGRAM_ID})`,
      parsePubkey,
      Promise.resolve(VALIDATOR_BONDS_PROGRAM_ID),
    )
  },
  installSubcommands: program => {
    installCommands(program)
  },
  npmRegistryUrl: VALIDATOR_BONDS_NPM_URL,
})
