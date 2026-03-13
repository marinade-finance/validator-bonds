export type { BondsEventV1, BondsEventInnerType } from 'bonds-event-v1'
import { SCHEMA } from 'bonds-event-v1'

import type { BondsEventV1 } from 'bonds-event-v1'

export type NotificationPriority = 'critical' | 'warning' | 'info'

export interface EvaluationResult {
  shouldNotify: boolean
  priority: NotificationPriority
  relevanceHours: number
  notificationId: string | null
  routingKey: string
}

export interface NotificationContent {
  title: string
  body: string
  dataPoints?: Array<{
    label: string
    value: string
  }>
}

export interface BondsNotificationBrain {
  evaluate(event: BondsEventV1): EvaluationResult | null
  extractUserId(event: BondsEventV1): string
  buildContent(
    event: BondsEventV1,
    evaluation: EvaluationResult,
  ): NotificationContent
}

/**
 * Canonical list of all bond event inner types — derived from the JSON Schema
 * so there is a single source of truth (the schema definition).
 * Use this for runtime checks (e.g., validating routing config completeness).
 */
export const BONDS_EVENT_INNER_TYPES = SCHEMA.$defs.BondsEventInnerType.enum

export interface PriorityRule {
  condition: string
  priority: NotificationPriority
  shouldNotify?: boolean
}

export interface UnderfundedConfig {
  min_deficit_sol: number
  priority_rules: PriorityRule[]
  significant_change_pct: number
  renotify_interval_hours: number
  relevance_hours: number
}

export interface SimpleEventConfig {
  priority: NotificationPriority
  renotify_interval_hours: number
  relevance_hours: number
}

export interface CapChangedConfig {
  notify_cap_types: string[]
  notify_cap_types_priority: NotificationPriority
  other_caps_priority: NotificationPriority
  other_caps_shouldNotify: boolean
  renotify_interval_hours: number
  relevance_hours: number
}

export interface AnnouncementConfig {
  priority: NotificationPriority
  skip_dedup: boolean
  relevance_hours: number
}

export interface PassthroughEventConfig {
  priority: NotificationPriority
  relevance_hours: number
  skip_dedup?: boolean
}

export interface ThresholdConfig {
  evaluated_events: {
    bond_underfunded_change: UnderfundedConfig
    auction_exited: SimpleEventConfig
    cap_changed: CapChangedConfig
    bond_removed: SimpleEventConfig
    announcement: AnnouncementConfig
  }
  passthrough_events: Record<string, PassthroughEventConfig>
}
