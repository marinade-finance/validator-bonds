#!/usr/bin/env node

import { launchCliProgram } from '@marinade.finance/validator-bonds-cli-core'
import { VALIDATOR_BONDS_PROGRAM_ID } from '@marinade.finance/validator-bonds-sdk'
import { installCommands } from './commands'
import { parsePubkey } from '@marinade.finance/web3js-1x'

export const VALIDATOR_BONDS_NPM_URL =
  'https://registry.npmjs.org/@marinade.finance/validator-bonds-cli'

launchCliProgram({
  version: '2.2.0',
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
