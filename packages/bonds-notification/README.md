# @marinade.finance/bonds-notification

The "brain" library for the bond notification system. Evaluates bond events emitted by the `bonds-eventing` module and decides **whether** to notify, at what **priority**, and generates **dedup keys** — consumed by the `marinade-notifications` consumer service.

## What it does

1. **Evaluate** — applies YAML-configured threshold rules to a `BondsEventV1` event and returns an `EvaluationResult` (should notify, priority, relevance window, dedup notification ID)
2. **Build content** — produces a `NotificationContent` with title, body, and optional structured data points for delivery channels
3. **Dedup via notification ID** — generates deterministic SHA-256 hashes encoding the event type, magnitude bucket, and time bucket so that duplicate/unchanged situations are suppressed while significant changes or re-notify intervals produce new IDs

## Usage

```typescript
import { createBondsNotificationBrain } from '@marinade.finance/bonds-notification'

const brain = await createBondsNotificationBrain() // async — validates YAML config

const evaluation = brain.evaluate(event) // null = unknown event, skip
if (evaluation?.shouldNotify) {
  const userId = brain.extractUserId(event) // vote_account
  const content = brain.buildContent(event, evaluation)
  // content.title, content.body, content.dataPoints
}
```

## Evaluated event types

| inner_type                | Notifies                                      | Priority logic               |
| ------------------------- | --------------------------------------------- | ---------------------------- |
| `bond_underfunded_change` | When deficit exceeds threshold                | Rule-based on epoch coverage |
| `auction_exited`          | Always                                        | Critical                     |
| `cap_changed`             | For actionable cap types (BOND, COUNTRY, ASO) | Warning                      |
| `bond_removed`            | Always                                        | Critical                     |
| `announcement`            | Always (skips dedup)                          | Critical                     |

Passthrough events (`first_seen`, `auction_entered`, `bond_balance_change`, `version_bump`) are forwarded at info priority for API/dashboard consumption.

## Configuration

Thresholds are defined in `src/config/thresholds.yaml` and bundled with the package. They control min deficit thresholds, priority rules, re-notify intervals, and relevance windows.
