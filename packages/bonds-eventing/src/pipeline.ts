import * as fs from 'fs'

import { createPool, createTypeParserPreset } from 'slonik'

import { emitEvents } from './emit-events'
import { persistEvents } from './persist-events'
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
import type { CommonQueryMethods } from 'slonik'

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

  let pool: Awaited<ReturnType<typeof createPool>> | null = null

  try {
    if (config.postgresUrl) {
      const poolConfig: Parameters<typeof createPool>[1] = {
        typeParsers: [
          ...createTypeParserPreset(),
          {
            name: 'timestamptz',
            parse: (timestamp: string) => new Date(timestamp).toISOString(),
          },
          {
            name: 'numeric',
            parse: (numeric: string) => numeric,
          },
        ],
        maximumPoolSize: 5,
      }

      if (config.postgresSslRootCert) {
        const ca = fs.readFileSync(config.postgresSslRootCert, 'utf8')
        ;(poolConfig as Record<string, unknown>).ssl = {
          rejectUnauthorized: true,
          ca: [ca],
        }
      }

      pool = await createPool(config.postgresUrl, poolConfig)
      previousState = await loadPreviousState(pool, bondType, logger)
    } else {
      logger.warn(
        'No POSTGRES_URL configured, running without state (all validators will be first_seen)',
      )
    }

    const events = opts.evaluate(validators, previousState, epoch)

    const results = await emitEvents(events, config, logger)

    if (pool && !config.dryRun) {
      await persistEvents(pool, results, logger)

      // Save current state per validator — only for validators whose events all posted successfully
      const failedVoteAccounts = new Set<string>()
      for (const [event, result] of results) {
        if (result.status === 'failed') {
          failedVoteAccounts.add(event.vote_account)
        }
      }

      if (failedVoteAccounts.size > 0) {
        logger.warn(
          `${failedVoteAccounts.size} validator(s) had failed events — their state will not be saved so deltas are retried on next run`,
        )
      }

      const succeededStates = validators
        .filter(v => !failedVoteAccounts.has(opts.voteAccountOf(v)))
        .map(v => opts.toState(v, epoch))

      // Delete state only for delisted validators whose validator_delisted event succeeded.
      // All currently tracked validators must keep their state rows (even if their events failed).
      const keepVoteAccounts = new Set(validators.map(opts.voteAccountOf))
      for (const va of failedVoteAccounts) {
        keepVoteAccounts.add(va) // don't delete state for failed removals either
      }

      // Save state + delete removed in a single transaction for consistency
      await pool.transaction(async tx => {
        if (succeededStates.length > 0) {
          await saveCurrentState(tx, succeededStates, logger)
        }
        await deleteRemovedValidators(tx, bondType, keepVoteAccounts, logger)
        if (opts.saveMeta) {
          await opts.saveMeta(tx)
        }
      })
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
