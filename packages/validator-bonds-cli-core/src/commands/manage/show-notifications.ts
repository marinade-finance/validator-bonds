import {
  CliCommandError,
  FORMAT_TYPE_DEF,
  printData,
} from '@marinade.finance/cli-common'
import {
  createSubscriptionClient,
  NetworkError,
} from '@marinade.finance/ts-subscription-client'
import { parsePubkey } from '@marinade.finance/web3js-1x'
import { Option } from 'commander'

import {
  NOTIFICATIONS_API_URL_DEFAULT,
  NOTIFICATIONS_API_URL_ENV,
} from './subscribe'
import { getCliContext } from '../../context'
import { getBondFromAddress } from '../../utils'

import type { FormatType } from '@marinade.finance/cli-common'
import type { PublicKey } from '@solana/web3.js'
import type { Command } from 'commander'

export function configureShowNotifications(program: Command): Command {
  return program
    .command('show-notifications')
    .description('Show notifications for a bond.')
    .argument(
      '<bond-or-vote>',
      'Address of the bond account or vote account.',
      parsePubkey,
    )
    .option(
      `-f, --format <${FORMAT_TYPE_DEF.join('|')}>`,
      'Format of output',
      'text',
    )
    .addOption(
      new Option(
        '--notifications-api-url <url>',
        'Override notification service URL',
      )
        .env(NOTIFICATIONS_API_URL_ENV)
        .default(NOTIFICATIONS_API_URL_DEFAULT)
        .hideHelp(),
    )
    .option(
      '--priority <priority>',
      'Filter by priority level (critical, warning, info)',
    )
    .option('--inner-type <type>', 'Filter by notification inner type')
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
  notificationsApiUrl,
  priority,
  innerType,
  limit,
}: {
  address: PublicKey
  config: PublicKey
  format: FormatType
  notificationsApiUrl: string
  priority?: string
  innerType?: string
  limit: number
}) {
  const { program, logger } = getCliContext()

  const bondAccountData = await getBondFromAddress({
    program,
    address,
    config,
    logger,
  })
  const voteAccount = bondAccountData.account.data.voteAccount

  const client = createSubscriptionClient({
    base_url: notificationsApiUrl,
    logger,
  })

  try {
    const data = await client.listNotifications({
      user_id: voteAccount.toBase58(),
      notification_type: 'sam_auction',
      priority,
      inner_type: innerType,
      limit,
    })

    if (data.length === 0) {
      logger.info(
        `No notifications found for vote account ${voteAccount.toBase58()}`,
      )
      return
    }

    printData(
      {
        voteAccount: voteAccount.toBase58(),
        notifications: data as unknown as Record<string, unknown>[],
      },
      format,
    )
  } catch (e) {
    if (e instanceof NetworkError) {
      throw new CliCommandError({
        valueName: 'notifications',
        value: e.status ? `HTTP ${e.status}` : 'connection error',
        msg: `Failed to fetch notifications: ${e.message}`,
      })
    }
    throw e
  }
}
