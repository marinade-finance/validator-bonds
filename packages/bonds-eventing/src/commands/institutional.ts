import { getContext } from '@marinade.finance/ts-common'
import { Option } from 'commander'

import { addSharedEventingOptions } from './options'
import { logResolvedConfig, parseConfig } from '../config'
import {
  evaluateInstitutionalDeltas,
  institutionalValidatorToState,
} from '../evaluate-institutional-deltas'
import { runEventingPipeline } from '../pipeline'
import { runInstitutional } from '../run-institutional'

import type { Command } from 'commander'

export function installInstitutional(program: Command) {
  addSharedEventingOptions(
    program
      .command('institutional')
      .description('Run eventing for institutional bond type'),
  )
    .addOption(
      new Option(
        '--institutional-api-url <url>',
        'Institutional staking API base URL',
      )
        .env('INSTITUTIONAL_API_URL')
        .default('https://institutional-staking.marinade.finance'),
    )
    .action(manageInstitutional)
}

async function manageInstitutional(opts: Record<string, unknown>) {
  const { logger } = getContext()
  const config = parseConfig(opts)
  const bondType = 'institutional'

  logResolvedConfig(logger, config)

  const { validators, epoch } = await runInstitutional(config, logger)

  await runEventingPipeline({
    bondType,
    config,
    logger,
    validators,
    epoch,
    voteAccountOf: v => v.voteAccount,
    evaluate: (vals, previousState, ep) =>
      evaluateInstitutionalDeltas(vals, previousState, ep, logger),
    toState: institutionalValidatorToState,
  })
}
