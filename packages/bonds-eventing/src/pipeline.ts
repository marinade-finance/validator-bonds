import { emitEvents } from './emit-events'
import { persistEvents } from './persist-events'
import { loadPreviousState, saveState } from './state'

import type { AuctionMeta } from './calc-relay'
import type { Directory } from './directory'
import type {
  BondType,
  BondsEventV1,
  EventingConfig,
  ValidatorState,
} from './types'
import type { LoggerWrapper } from '@marinade.finance/ts-common'

export async function runEventingPipeline<V>(opts: {
  bondType: BondType
  config: EventingConfig
  dir: Directory
  logger: LoggerWrapper
  validators: V[]
  epoch: number
  voteAccountOf: (v: V) => string
  evaluate: (
    validators: V[],
    previousState: Map<string, ValidatorState>,
    epoch: number,
  ) => BondsEventV1[]
  toState: (v: V, epoch: number) => ValidatorState
  meta?: AuctionMeta
}): Promise<void> {
  const { bondType, config, dir, logger, validators, epoch } = opts

  try {
    const previous = await loadPreviousState(dir, bondType, logger)

    const events = opts.evaluate(validators, previous.validators, epoch)

    const results = await emitEvents(events, config, logger)

    if (!config.dryRun) {
      await persistEvents(dir, results, logger)

      const failedVoteAccounts = new Set<string>()
      for (const [event, result] of results) {
        if (result.status === 'failed') {
          failedVoteAccounts.add(event.vote_account)
        }
      }

      if (failedVoteAccounts.size > 0) {
        logger.warn(
          `${failedVoteAccounts.size} validator(s) had failed events — their state is kept as it was so deltas are retried on next run`,
        )
      }

      // A validator whose events all posted takes its new state; one with a
      // failed event keeps the entry the previous run left.
      const currentVoteAccounts = new Set<string>()
      for (const validator of validators) {
        const voteAccount = opts.voteAccountOf(validator)
        currentVoteAccounts.add(voteAccount)
        if (!failedVoteAccounts.has(voteAccount)) {
          previous.validators.set(voteAccount, opts.toState(validator, epoch))
        }
      }

      // A delisted validator leaves the document once its delist event posted.
      for (const voteAccount of previous.validators.keys()) {
        if (
          !currentVoteAccounts.has(voteAccount) &&
          !failedVoteAccounts.has(voteAccount)
        ) {
          previous.validators.delete(voteAccount)
        }
      }

      // A 412 here means a second run wrote the document while this one was
      // emitting; it propagates, because its events are already POSTed and
      // re-evaluating against the winner's state would emit them again.
      await saveState(
        dir,
        bondType,
        {
          epoch,
          meta: opts.meta ?? previous.meta,
          validators: previous.validators,
        },
        previous.etag,
        logger,
      )
    }

    const sent = [...results.values()].filter(r => r.status === 'sent').length
    const failed = [...results.values()].filter(
      r => r.status === 'failed',
    ).length
    logger.info(
      `Eventing complete: ${events.length} events (${sent} sent, ${failed} failed)`,
    )
  } catch (err) {
    // Surface the stack and any structured payload so log scrapers see more
    // than just `err.message` (the top-level handler in `index.ts` only logs
    // the message).
    logger.error(
      {
        err:
          err instanceof Error
            ? { name: err.name, message: err.message, stack: err.stack }
            : err,
      },
      'Eventing failed',
    )
    throw err
  }
}
