import { getContext, lamportsToSol } from '@marinade.finance/ts-common'
import { Option } from 'commander'

import { addStoreOptions } from './options'
import { logResolvedConfig, parseConfig } from '../config'
import {
  evaluateInstitutionalDeltas,
  institutionalValidatorToState,
} from '../evaluate-institutional-deltas'
import {
  diffProjectedPenalties,
  evaluateProjectedDeltas,
  projectVatPenalty,
} from '../penalty-projections'
import { runEventingPipeline, type PipelineHandlers } from '../pipeline'
import { runInstitutional } from '../run-institutional'
import { fetchVatForecastOrNull } from '../vat-forecast'

import type { Projection } from '../penalty-projections'
import type { InstitutionalValidatorData } from '../types'
import type { VatForecast } from '../vat-forecast'
import type { LoggerWrapper } from '@marinade.finance/ts-common'
import type { Command } from 'commander'

export function installInstitutional(program: Command) {
  addStoreOptions(
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
  const vat = await fetchVatForecastOrNull(config.validatorsApiUrl, logger)

  await runEventingPipeline({
    bondType,
    config,
    logger,
    validators,
    epoch,
    voteAccountOf: v => v.voteAccount,
    ...institutionalHandlers(vat, logger),
  })
}

export function institutionalHandlers(
  vat: VatForecast | null,
  logger: LoggerWrapper,
): PipelineHandlers<InstitutionalValidatorData> {
  // The institutional API reports the last closed epoch; the VAT verdict is of the running one.
  const projectionOf = (v: InstitutionalValidatorData): Projection => ({
    sam: null,
    vat: vat
      ? projectVatPenalty(
          vat,
          v.voteAccount,
          lamportsToSol(v.institutionalStakeLamports).toNumber(),
          'institutional',
          vat.epoch,
        )
      : null,
  })
  const forEpochOf = (epoch: number) => (vat?.epoch ?? epoch) + 1
  return {
    evaluate: (vals, previousState, ep) => [
      ...evaluateInstitutionalDeltas(vals, previousState, ep, logger),
      ...evaluateProjectedDeltas(
        vals,
        previousState,
        ep,
        forEpochOf(ep),
        'institutional',
        v => v.voteAccount,
        v => v.bondPubkey,
        projectionOf,
      ),
    ],
    toState: (v, ep, prev) => ({
      ...institutionalValidatorToState(v, ep),
      projected_penalties: diffProjectedPenalties(
        prev?.projected_penalties,
        projectionOf(v),
        forEpochOf(ep),
        v.voteAccount,
      ).next,
    }),
  }
}
