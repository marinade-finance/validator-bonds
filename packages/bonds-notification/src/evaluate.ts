import { computeAmountBucket, makeNotificationId } from './notification-id'

import type {
  BondsEventV1,
  CapChangedConfig,
  EvaluationResult,
  PassthroughEventConfig,
  SimpleEventConfig,
  ThresholdConfig,
  UnderfundedConfig,
} from './types'

export function evaluate(
  event: BondsEventV1,
  config: ThresholdConfig,
): EvaluationResult | null {
  switch (event.inner_type) {
    case 'bond_underfunded_change':
      return evaluateUnderfunded(
        event,
        config.evaluated_events.bond_underfunded_change,
      )

    case 'auction_exited':
      return evaluateSimple(event, config.evaluated_events.auction_exited)

    case 'cap_changed':
      return evaluateCapChanged(event, config.evaluated_events.cap_changed)

    case 'bond_removed':
      return evaluateSimple(event, config.evaluated_events.bond_removed)

    case 'announcement':
      return {
        shouldNotify: true,
        priority: config.evaluated_events.announcement.priority,
        relevanceHours: config.evaluated_events.announcement.relevance_hours,
        notificationId: null, // skip dedup
        routingKey: 'announcement',
      }

    case 'first_seen':
    case 'auction_entered':
    case 'bond_balance_change':
    case 'version_bump': {
      const passthroughConfig = config.passthrough_events[event.inner_type]
      if (!passthroughConfig) return null
      return evaluatePassthrough(event, passthroughConfig)
    }

    default:
      return null // unknown inner_type
  }
}

function evaluateUnderfunded(
  event: BondsEventV1,
  cfg: UnderfundedConfig,
): EvaluationResult {
  const details = event.data.details
  const currentEpochs = details.current_epochs as number | null | undefined

  // If we can't determine coverage, notify as warning (data issue)
  if (currentEpochs === null || currentEpochs === undefined) {
    return {
      shouldNotify: true,
      priority: 'warning',
      relevanceHours: cfg.relevance_hours,
      notificationId: makeNotificationId(
        event.vote_account,
        'underfunded',
        'unknown',
        event.created_at,
        cfg.renotify_interval_hours,
      ),
      routingKey: 'bond_underfunded_change',
    }
  }

  // Apply priority rules in order (first match wins)
  for (const rule of cfg.priority_rules) {
    if (matchesCondition(rule.condition, currentEpochs)) {
      if (rule.shouldNotify === false) {
        return {
          shouldNotify: false,
          priority: rule.priority,
          relevanceHours: cfg.relevance_hours,
          notificationId: null,
          routingKey: 'bond_underfunded_change',
        }
      }

      // Check minimum deficit threshold
      const deficitSol = computeDeficitSol(details)
      if (deficitSol !== null && deficitSol < cfg.min_deficit_sol) {
        return {
          shouldNotify: false,
          priority: rule.priority,
          relevanceHours: cfg.relevance_hours,
          notificationId: null,
          routingKey: 'bond_underfunded_change',
        }
      }

      const amountBucket =
        deficitSol !== null
          ? computeAmountBucket(deficitSol, cfg.significant_change_pct)
          : 'unknown'

      return {
        shouldNotify: true,
        priority: rule.priority,
        relevanceHours: cfg.relevance_hours,
        notificationId: makeNotificationId(
          event.vote_account,
          'underfunded',
          String(amountBucket),
          event.created_at,
          cfg.renotify_interval_hours,
        ),
        routingKey: 'bond_underfunded_change',
      }
    }
  }

  // No rule matched
  return {
    shouldNotify: false,
    priority: 'info',
    relevanceHours: cfg.relevance_hours,
    notificationId: null,
    routingKey: 'bond_underfunded_change',
  }
}

function evaluateCapChanged(
  event: BondsEventV1,
  cfg: CapChangedConfig,
): EvaluationResult {
  const currentCap = event.data.details.current_cap as string | null | undefined

  const isActionableCap =
    currentCap !== null &&
    currentCap !== undefined &&
    cfg.notify_cap_types.includes(currentCap)

  if (isActionableCap) {
    return {
      shouldNotify: true,
      priority: cfg.notify_cap_types_priority,
      relevanceHours: cfg.relevance_hours,
      notificationId: makeNotificationId(
        event.vote_account,
        'cap_changed',
        currentCap,
        event.created_at,
        cfg.renotify_interval_hours,
      ),
      routingKey: 'cap_changed',
    }
  }

  return {
    shouldNotify: cfg.other_caps_shouldNotify ?? false,
    priority: cfg.other_caps_priority ?? 'info',
    relevanceHours: cfg.relevance_hours,
    notificationId: null,
    routingKey: 'cap_changed',
  }
}

function evaluateSimple(
  event: BondsEventV1,
  cfg: SimpleEventConfig,
): EvaluationResult {
  const epoch = String(event.epoch)
  return {
    shouldNotify: true,
    priority: cfg.priority,
    relevanceHours: cfg.relevance_hours,
    notificationId: makeNotificationId(
      event.vote_account,
      event.inner_type,
      epoch,
      event.created_at,
      cfg.renotify_interval_hours,
    ),
    routingKey: event.inner_type,
  }
}

function evaluatePassthrough(
  event: BondsEventV1,
  cfg: PassthroughEventConfig,
): EvaluationResult {
  if (cfg.skip_dedup) {
    return {
      shouldNotify: true,
      priority: cfg.priority,
      relevanceHours: cfg.relevance_hours,
      notificationId: null,
      routingKey: event.inner_type,
    }
  }

  const epoch = String(event.epoch)
  // Use a very large renotify interval (effectively once per epoch)
  const LARGE_INTERVAL_HOURS = 24 * 365
  return {
    shouldNotify: true,
    priority: cfg.priority,
    relevanceHours: cfg.relevance_hours,
    notificationId: makeNotificationId(
      event.vote_account,
      event.inner_type,
      epoch,
      event.created_at,
      LARGE_INTERVAL_HOURS,
    ),
    routingKey: event.inner_type,
  }
}

export function matchesCondition(
  condition: string,
  currentEpochs: number,
): boolean {
  const match = condition.match(/^currentEpochs\s*(>=|<=|>|<|===|==)\s*(\d+)$/)
  if (!match) throw new Error(`Invalid condition expression: ${condition}`)
  const [, op, valueStr] = match
  const value = Number(valueStr)
  switch (op) {
    case '<':
      return currentEpochs < value
    case '<=':
      return currentEpochs <= value
    case '>':
      return currentEpochs > value
    case '>=':
      return currentEpochs >= value
    case '==':
    case '===':
      return currentEpochs === value
    default:
      return false
  }
}

function computeDeficitSol(details: Record<string, unknown>): number | null {
  const deficitSol = details.deficit_sol as number | undefined
  return deficitSol !== undefined ? deficitSol : null
}
