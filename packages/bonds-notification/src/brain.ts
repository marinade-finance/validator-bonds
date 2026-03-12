import { buildContent } from './content'
import { evaluate } from './evaluate'
import { loadThresholdConfig } from './threshold-config'

import type {
  BondsEventV1,
  BondsNotificationBrain,
  EvaluationResult,
  NotificationContent,
} from './types'

class BondsNotificationBrainImpl implements BondsNotificationBrain {
  evaluate(event: BondsEventV1): EvaluationResult | null {
    const config = loadThresholdConfig()
    return evaluate(event, config)
  }

  extractUserId(event: BondsEventV1): string {
    return event.vote_account
  }

  buildContent(
    event: BondsEventV1,
    evaluation: EvaluationResult,
  ): NotificationContent {
    return buildContent(event, evaluation)
  }
}

export function createBondsNotificationBrain(): BondsNotificationBrain {
  return new BondsNotificationBrainImpl()
}
