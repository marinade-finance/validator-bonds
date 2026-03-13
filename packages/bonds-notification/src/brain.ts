import { buildContent } from './content'
import { evaluate } from './evaluate'
import { loadThresholdConfig } from './threshold-config'

import type {
  BondsEventV1,
  BondsNotificationBrain,
  EvaluationResult,
  NotificationContent,
  ThresholdConfig,
} from './types'

class BondsNotificationBrainImpl implements BondsNotificationBrain {
  constructor(private readonly config: ThresholdConfig) {}

  evaluate(event: BondsEventV1): EvaluationResult | null {
    return evaluate(event, this.config)
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

export async function createBondsNotificationBrain(): Promise<BondsNotificationBrain> {
  const config = await loadThresholdConfig()
  return new BondsNotificationBrainImpl(config)
}
