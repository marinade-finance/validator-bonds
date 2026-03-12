import type {
  BondsEventV1,
  EvaluationResult,
  NotificationContent,
} from './types'

function str(value: unknown, fallback: string = 'unknown'): string {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value as string | number | boolean)
}

export function buildContent(
  event: BondsEventV1,
  _evaluation: EvaluationResult,
): NotificationContent {
  const details = event.data.details

  switch (event.inner_type) {
    case 'bond_underfunded_change':
      return {
        title: 'Bond Underfunded',
        body: event.data.message,
        dataPoints: [
          {
            label: 'Coverage',
            value: `${str(details.current_epochs)} epochs`,
          },
          {
            label: 'Balance',
            value: `${str(details.bond_balance_sol)} SOL`,
          },
          ...(details.deficit_sol != null
            ? [{ label: 'Deficit', value: `${str(details.deficit_sol)} SOL` }]
            : []),
        ],
      }

    case 'auction_exited':
      return {
        title: 'Removed from Auction',
        body: event.data.message,
      }

    case 'cap_changed':
      return {
        title: 'Stake Cap Changed',
        body: event.data.message,
        dataPoints: [
          {
            label: 'Previous cap',
            value: str(details.previous_cap, 'none'),
          },
          {
            label: 'Current cap',
            value: str(details.current_cap, 'none'),
          },
        ],
      }

    case 'bond_removed':
      return {
        title: 'Bond Removed',
        body: event.data.message,
      }

    case 'announcement':
      return {
        title: 'Announcement',
        body: event.data.message,
      }

    case 'first_seen':
      return {
        title: 'New Bond Detected',
        body: event.data.message,
        dataPoints: [
          {
            label: 'Balance',
            value: `${str(details.bond_balance_sol)} SOL`,
          },
          {
            label: 'In auction',
            value: str(details.in_auction),
          },
        ],
      }

    case 'auction_entered':
      return {
        title: 'Entered Auction',
        body: event.data.message,
      }

    case 'bond_balance_change':
      return {
        title: 'Bond Balance Changed',
        body: event.data.message,
      }

    case 'version_bump':
      return {
        title: 'Version Bump',
        body: event.data.message,
      }

    default:
      return {
        title: event.inner_type,
        body: event.data.message,
      }
  }
}
