import {
  CliCommandError,
  FORMAT_TYPE_DEF,
  printData,
} from '@marinade.finance/cli-common'
import {
  BONDS_EVENT_INNER_TYPES,
  NOTIFICATION_PRIORITIES,
  createSubscriptionClient,
} from '@marinade.finance/notifications-ts-subscription-client'
import { parsePubkey } from '@marinade.finance/web3js-1x'
import { Option } from 'commander'

import { getCliContext } from '../../context'
import { formatHttpError, getBondFromAddress } from '../../utils'

import type { FormatType } from '@marinade.finance/cli-common'
import type {
  BondsEventInnerType,
  NotificationPriority,
} from '@marinade.finance/notifications-ts-subscription-client'
import type { PublicKey } from '@solana/web3.js'
import type { Command } from 'commander'

export function configureShowNotifications(program: Command): Command {
  return program
    .command('show-notifications')
    .description(
      'Show notifications for a bond. ' +
        'When no address is provided, shows broadcast announcements.',
    )
    .argument(
      '[bond-or-vote]',
      'Address of the bond account or vote account (optional).',
      parsePubkey,
    )
    .option(
      `-f, --format <${FORMAT_TYPE_DEF.join('|')}>`,
      'Format of output',
      'text',
    )
    .addOption(
      new Option('--priority <priority>', 'Filter by priority level').choices(
        NOTIFICATION_PRIORITIES,
      ),
    )
    .addOption(
      new Option(
        '--inner-type <type>',
        'Filter by notification inner type',
      ).choices(BONDS_EVENT_INNER_TYPES),
    )
    .option(
      '--limit <number>',
      'Maximum number of notifications to fetch',
      '50',
    )
}

export async function showNotifications({
  address,
  config,
  format,
  priority,
  innerType,
  limit,
}: {
  address?: PublicKey
  config: PublicKey
  format: FormatType
  priority?: NotificationPriority
  innerType?: BondsEventInnerType
  limit: number
}) {
  const { program, logger, notificationsApiUrl, notificationType } =
    getCliContext()

  const client = createSubscriptionClient({
    base_url: notificationsApiUrl,
    logger,
  })

  try {
    let voteAccount: string | undefined
    let data

    if (address) {
      const bondAccountData = await getBondFromAddress({
        program,
        address,
        config,
        logger,
      })
      voteAccount = bondAccountData.account.data.voteAccount.toBase58()
      data = await client.listNotifications({
        user_id: voteAccount,
        notification_type: notificationType,
        priority,
        inner_type: innerType,
        limit,
      })
    } else {
      data = await client.listBroadcastNotifications({
        notification_type: notificationType,
        priority,
        inner_type: innerType,
        limit,
      })
    }

    if (data.length === 0) {
      logger.info(
        voteAccount
          ? `No notifications found for vote account ${voteAccount}`
          : 'No broadcast notifications found',
      )
      return
    }

    printData(
      {
        ...(voteAccount && { voteAccount }),
        notifications: data,
      },
      format,
    )
  } catch (e) {
    const httpMsg = formatHttpError(e, notificationsApiUrl)
    if (httpMsg) {
      throw new CliCommandError({
        valueName: 'notifications',
        value: 'network error',
        msg: `Failed to fetch notifications. ${httpMsg}`,
      })
    }
    throw e
  }
}
