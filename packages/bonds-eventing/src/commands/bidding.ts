import { getContext } from '@marinade.finance/ts-common'
import { Option } from 'commander'

import { addSharedEventingOptions } from './options'
import { logResolvedConfig, parseConfig } from '../config'
import { evaluateDeltas, validatorToState } from '../evaluate-deltas'
import { runEventingPipeline } from '../pipeline'
import { runAuction } from '../run-auction'
import { saveAuctionMeta } from '../state'

import type { Command } from 'commander'

export function installBidding(program: Command) {
  addSharedEventingOptions(
    program
      .command('bidding')
      .description('Run eventing for bidding bond type'),
  )
    .addOption(
      new Option('--validators-api-url <url>', 'Validators API base URL')
        .env('VALIDATORS_API_URL')
        .default('https://validators-api.marinade.finance'),
    )
    .addOption(
      new Option('--scoring-api-url <url>', 'Scoring API base URL')
        .env('SCORING_API_URL')
        .default('https://scoring.marinade.finance'),
    )
    .addOption(
      new Option('--tvl-api-url <url>', 'TVL info API base URL')
        .env('TVL_API_URL')
        .default('https://api.marinade.finance'),
    )
    .addOption(
      new Option(
        '--cache-inputs <dir>',
        'Cache ds-sam-sdk API responses to dir (for debugging)',
      ).env('CACHE_INPUTS_DIR'),
    )
    .action(manageBidding)
}

async function manageBidding(opts: Record<string, unknown>) {
  const { logger } = getContext()
  const config = parseConfig(opts)
  const bondType = 'bidding'

  logResolvedConfig(logger, config)

  const { validators, epoch, meta } = await runAuction(config, logger)

  await runEventingPipeline({
    bondType,
    config,
    logger,
    validators,
    epoch,
    voteAccountOf: v => v.voteAccount,
    evaluate: (vals, previousState, ep) =>
      evaluateDeltas(vals, previousState, ep, bondType, logger),
    toState: (v, ep) => validatorToState(v, ep, bondType),
    saveMeta: tx => saveAuctionMeta(tx, bondType, meta, logger),
  })
}
