import { createEventingPool } from './db'
import { insertPendingEvents } from './persist-events'
import {
  deleteRemovedValidators,
  loadPreviousState,
  saveCurrentState,
} from './state'

import type {
  BondType,
  BondsEventV1,
  EventingConfig,
  ValidatorState,
} from './types'
import type { LoggerWrapper } from '@marinade.finance/ts-common'
import type { CommonQueryMethods, DatabasePool } from 'slonik'

export async function runEventingPipeline<V>(opts: {
  bondType: BondType
  config: EventingConfig
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
  saveMeta?: (tx: CommonQueryMethods) => Promise<void>
}): Promise<void> {
  const { bondType, config, logger, validators, epoch } = opts

  let previousState = new Map<string, ValidatorState>()

  let pool: DatabasePool | null = null

  try {
    if (config.postgresUrl) {
      pool = await createEventingPool(
        config.postgresUrl,
        config.postgresSslRootCert,
      )
      previousState = await loadPreviousState(pool, bondType, logger)
    } else {
      logger.warn(
        'No POSTGRES_URL configured, running without state (all validators will be first_seen)',
      )
    }

    const events = opts.evaluate(validators, previousState, epoch)

    if (!pool || config.dryRun) {
      logger.info(
        pool
          ? `[DRY RUN] Would store ${events.length} events`
          : `No POSTGRES_URL configured, ${events.length} events not stored`,
      )
      for (const event of events) {
        logger.info({ event }, `${event.inner_type} for ${event.vote_account}`)
      }
      return
    }

    const states = validators.map(v => opts.toState(v, epoch))
    await pool.transaction(async tx => {
      if (states.length > 0) {
        await saveCurrentState(tx, states, logger)
      }
      await deleteRemovedValidators(
        tx,
        bondType,
        new Set(validators.map(opts.voteAccountOf)),
        logger,
      )
      await insertPendingEvents(tx, events, logger)
      if (opts.saveMeta) {
        await opts.saveMeta(tx)
      }
    })

    logger.info(`Eventing stored: ${events.length} events pending`)
  } catch (err) {
    // Surface the stack and any structured payload so log scrapers see more
    // than just `err.message` (the top-level handler in `index.ts` only logs
    // the message, which made past slonik failures untraceable).
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
  } finally {
    if (pool) {
      await pool.end()
    }
  }
}
