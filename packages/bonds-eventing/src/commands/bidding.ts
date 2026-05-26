import * as fs from 'fs'

import { getContext } from '@marinade.finance/ts-common'
import { Option } from 'commander'
import { createPool, createTypeParserPreset } from 'slonik'

import { parseConfig } from '../config'
import { emitEvents } from '../emit-events'
import { evaluateDeltas, validatorToState } from '../evaluate-deltas'
import { persistEvents } from '../persist-events'
import { runAuction } from '../run-auction'
import {
  deleteRemovedValidators,
  loadPreviousState,
  saveCurrentState,
} from '../state'

import type { ValidatorState } from '../types'
import type { Command } from 'commander'

export function installBidding(program: Command) {
  program
    .command('bidding')
    .description('Run eventing for bidding bond type')
    .addOption(
      new Option('--bonds-api-url <url>', 'Validator bonds API base URL')
        .env('BONDS_API_URL')
        .default('https://validator-bonds-api.marinade.finance'),
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
        '--notifications-api-url <url>',
        'marinade-notifications base URL',
      ).env('NOTIFICATIONS_API_URL'),
    )
    .addOption(
      new Option(
        '--notifications-jwt <token>',
        'JWT for notifications API auth',
      ).env('NOTIFICATIONS_JWT'),
    )
    .addOption(
      new Option('--postgres-url <url>', 'PostgreSQL connection string').env(
        'POSTGRES_URL',
      ),
    )
    .addOption(
      new Option(
        '--postgres-ssl-root-cert <path>',
        'Path to SSL root cert',
      ).env('POSTGRES_SSL_ROOT_CERT'),
    )
    .addOption(
      new Option(
        '--retry-max-attempts <n>',
        'Max retries for notification POST',
      )
        .env('EVENTING_RETRY_MAX_ATTEMPTS')
        .default(4),
    )
    .addOption(
      new Option(
        '--retry-base-delay-ms <ms>',
        'Base delay for exponential backoff',
      )
        .env('EVENTING_RETRY_BASE_DELAY_MS')
        .default(30000),
    )
    .addOption(
      new Option(
        '--emit-concurrency <n>',
        'Number of events to POST in parallel',
      )
        .env('EVENTING_EMIT_CONCURRENCY')
        .default(20),
    )
    .addOption(
      new Option('--dry-run', 'Skip POST and DB write, just log events')
        .env('DRY_RUN')
        .default(false),
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

  logger.info(
    {
      ...config,
      notificationsJwt: config.notificationsJwt ? '***' : undefined,
      postgresUrl: config.postgresUrl ? '***' : undefined,
    },
    'Resolved configuration',
  )

  // 1. Run auction simulation
  const { validators, epoch } = await runAuction(config, logger)

  // 2. Load previous state and evaluate deltas
  let previousState = new Map<string, ValidatorState>()

  const hasDb = !!config.postgresUrl
  let pool: Awaited<ReturnType<typeof createPool>> | null = null

  try {
    if (hasDb) {
      const postgresUrl = config.postgresUrl as string
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

      pool = await createPool(postgresUrl, poolConfig)
      previousState = await loadPreviousState(pool, bondType, logger)
    } else {
      logger.warn(
        'No POSTGRES_URL configured, running without state (all validators will be first_seen)',
      )
    }

    // 3. Evaluate deltas
    const events = evaluateDeltas(
      validators,
      previousState,
      epoch,
      bondType,
      logger,
    )

    // 4. Emit events to notification service
    const results = await emitEvents(events, config, logger)

    // 5. Persist events to DB
    if (pool && !config.dryRun) {
      await persistEvents(pool, results, logger)

      // 6. Save current state per validator — only for validators whose events all posted successfully
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
        .filter(v => !failedVoteAccounts.has(v.voteAccount))
        .map(v => validatorToState(v, epoch, bondType))

      // Delete state only for delisted validators whose validator_delisted event succeeded.
      // All validators still in auction must keep their state rows (even if their events failed).
      const keepVoteAccounts = new Set(validators.map(v => v.voteAccount))
      for (const va of failedVoteAccounts) {
        keepVoteAccounts.add(va) // don't delete state for failed removals either
      }

      // Save state + delete removed in a single transaction for consistency
      await pool.transaction(async tx => {
        if (succeededStates.length > 0) {
          await saveCurrentState(tx, succeededStates, logger)
        }
        await deleteRemovedValidators(tx, bondType, keepVoteAccounts, logger)
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
