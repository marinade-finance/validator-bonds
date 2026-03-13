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

export interface BondsEventV1 {
  type: 'bonds'
  inner_type: BondsEventInnerType
  vote_account: string
  bond_pubkey: string | null
  bond_type: string
  epoch: number
  data: {
    message: string
    details: Record<string, unknown>
  }
  created_at: string
}

/**
 * Canonical list of all bond event inner types.
 * This const array is the single source of truth — the union type is derived from it.
 * Use this for runtime checks (e.g., validating routing config completeness).
 */
export const BONDS_EVENT_INNER_TYPES = [
  'first_seen',
  'bond_removed',
  'auction_entered',
  'auction_exited',
  'cap_changed',
  'bond_underfunded_change',
  'bond_balance_change',
  'announcement',
  'version_bump',
] as const

export type BondsEventInnerType = (typeof BONDS_EVENT_INNER_TYPES)[number]

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
