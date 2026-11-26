import { getContext } from '@marinade.finance/ts-common'
import { bondAddress } from '@marinade.finance/validator-bonds-sdk'
import { PublicKey } from '@solana/web3.js'
import { Option } from 'commander'

import { addStoreOptions } from './options'
import { logResolvedConfig, parseConfig } from '../config'
import {
  configAddressForBondType,
  evaluateDeltas,
  finiteOr,
  validatorToState,
} from '../evaluate-deltas'
import {
  diffProjectedPenalties,
  evaluateProjectedDeltas,
  projectSamPenalties,
  projectVatPenalty,
} from '../penalty-projections'
import { runEventingPipeline, type PipelineHandlers } from '../pipeline'
import { runAuction } from '../run-auction'
import { saveAuctionMeta } from '../state'
import { fetchVatForecastOrNull } from '../vat-forecast'

import type { AuctionMeta } from '../calc-relay'
import type { Projection } from '../penalty-projections'
import type { VatForecast } from '../vat-forecast'
import type { AuctionValidator } from '@marinade.finance/ds-sam-sdk'
import type { LoggerWrapper } from '@marinade.finance/ts-common'
import type { Command } from 'commander'

export function installBidding(program: Command) {
  addStoreOptions(
    program
      .command('bidding')
      .description('Run eventing for bidding bond type'),
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
  const vat = await fetchVatForecastOrNull(config.validatorsApiUrl, logger)

  await runEventingPipeline({
    bondType,
    config,
    logger,
    validators,
    epoch,
    voteAccountOf: v => v.voteAccount,
    ...biddingHandlers(meta, vat, logger),
    saveMeta: tx => saveAuctionMeta(tx, bondType, meta, logger),
  })
}

export function biddingHandlers(
  meta: AuctionMeta,
  vat: VatForecast | null,
  logger: LoggerWrapper,
): PipelineHandlers<AuctionValidator> {
  const bondType = 'bidding'
  const configAddress = configAddressForBondType(bondType)
  const projectionOf = (v: AuctionValidator, epoch: number): Projection => ({
    sam: projectSamPenalties(v, epoch, meta),
    vat: vat
      ? projectVatPenalty(
          vat,
          v.voteAccount,
          finiteOr(v.marinadeActivatedStakeSol, 0),
          bondType,
          epoch,
        )
      : null,
  })
  return {
    evaluate: (vals, previousState, ep) => [
      ...evaluateDeltas(
        vals,
        previousState,
        ep,
        bondType,
        logger,
        // Mirrors the offset ds-sam-sdk subtracts when it computes bondGoodForNEpochs.
        1 + meta.minBondEpochs,
      ),
      ...evaluateProjectedDeltas(
        vals,
        previousState,
        ep,
        ep + 1,
        bondType,
        v => v.voteAccount,
        v =>
          bondAddress(
            configAddress,
            new PublicKey(v.voteAccount),
          )[0].toBase58(),
        v => projectionOf(v, ep),
      ),
    ],
    toState: (v, ep, prev) => ({
      ...validatorToState(v, ep, bondType, prev),
      projected_penalties: diffProjectedPenalties(
        prev?.projected_penalties,
        projectionOf(v, ep),
        ep + 1,
        v.voteAccount,
      ).next,
    }),
  }
}
