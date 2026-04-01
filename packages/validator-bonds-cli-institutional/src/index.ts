#!/usr/bin/env node

import 'reflect-metadata'

import { NOTIFICATION_TYPE_INSTITUTIONAL_SELECT } from '@marinade.finance/notifications-ts-subscription-client'
import { launchCliProgram } from '@marinade.finance/validator-bonds-cli-core'
import { VALIDATOR_BONDS_PROGRAM_ID } from '@marinade.finance/validator-bonds-sdk'

import { installCommands } from './commands'

export const VALIDATOR_BONDS_NPM_URL =
  'https://registry.npmjs.org/@marinade.finance/validator-bonds-cli-institutional'

launchCliProgram({
  version: '2.4.2',
  installAdditionalOptions: program => {
    program.setOptionValueWithSource(
      'programId',
      VALIDATOR_BONDS_PROGRAM_ID,
      'default',
    )
  },
  installSubcommands: program => {
    installCommands(program)
  },
  npmRegistryUrl: VALIDATOR_BONDS_NPM_URL,
  notificationsConfig: {
    enabled: true,
    notificationType: NOTIFICATION_TYPE_INSTITUTIONAL_SELECT,
  },
})
