import { createSubscriptionClient } from '@marinade.finance/notifications-ts-subscription-client'

import type { Notification } from '@marinade.finance/notifications-ts-subscription-client'
import type { Logger } from 'pino'

const NOTIFICATION_BANNER_TIMEOUT_MS = 1500

export interface NotificationsConfig {
  enabled: boolean
  notificationType: string
}

let bannerPromise: Promise<Notification[] | null> | null = null

/**
 * Starts fetching broadcast notifications from the notifications API.
 * This is non-blocking — call getNotificationBanners() later to get the result.
 */
export function startFetchingNotificationBanners(
  params: {
    notificationType: string
    apiUrl: string
  },
  logger?: Logger,
): void {
  bannerPromise = fetchBroadcastNotifications(params, logger)
}

/**
 * Gets the broadcast notifications, waiting up to the specified timeout.
 * Returns null if no notifications available or on error.
 */
export async function getNotificationBanners(
  timeoutMs: number = NOTIFICATION_BANNER_TIMEOUT_MS,
): Promise<Notification[] | null> {
  if (!bannerPromise) {
    return null
  }

  try {
    return await Promise.race([
      bannerPromise,
      new Promise<null>(resolve => {
        setTimeout(() => resolve(null), timeoutMs)
      }),
    ])
  } catch {
    return null
  }
}

async function fetchBroadcastNotifications(
  params: {
    notificationType: string
    apiUrl: string
  },
  logger?: Logger,
): Promise<Notification[] | null> {
  try {
    const client = createSubscriptionClient({
      base_url: params.apiUrl,
      timeout_ms: NOTIFICATION_BANNER_TIMEOUT_MS,
      logger,
    })

    const notifications = await client.listBroadcastNotifications({
      notification_type: params.notificationType,
      limit: 10,
    })

    logger?.debug(
      `Loaded ${notifications.length} broadcast notifications from API`,
    )
    return notifications.length > 0 ? notifications : null
  } catch (error) {
    if (error instanceof Error) {
      logger?.debug(`Notifications API error: ${error.message}`)
    }
    return null
  }
}
