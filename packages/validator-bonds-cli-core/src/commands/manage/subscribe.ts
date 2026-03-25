import { exec } from 'child_process'

import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes'
import { CliCommandError } from '@marinade.finance/cli-common'
import {
  LedgerWallet,
  signOffchainMessage,
} from '@marinade.finance/ledger-utils'
import {
  createSubscriptionClient,
  NetworkError,
  subscribeMessage,
  NOTIFICATION_TYPE_SAM_AUCTION,
} from '@marinade.finance/ts-subscription-client'
import {
  instanceOfWallet,
  parsePubkey,
  parseWalletOrPubkeyOption,
} from '@marinade.finance/web3js-1x'
import { Option } from 'commander'

import { getCliContext } from '../../context'
import { getBondFromAddress } from '../../utils'

import type { LoggerWrapper } from '@marinade.finance/ts-common'
import type { SubscribeResponse } from '@marinade.finance/ts-subscription-client'
import type { KeypairWallet } from '@marinade.finance/web3js-1x'
import type { Wallet as WalletInterface } from '@marinade.finance/web3js-1x'
import type { PublicKey } from '@solana/web3.js'
import type { Command } from 'commander'

export const NOTIFICATIONS_API_URL_ENV = 'NOTIFICATIONS_API_URL'
export const NOTIFICATIONS_API_URL_DEFAULT =
  'https://notifications-api.marinade.finance'

function openUrl(url: string, logger: LoggerWrapper): void {
  const cmd =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'start ""'
        : 'xdg-open'
  exec(`${cmd} ${JSON.stringify(url)}`, error => {
    if (error) {
      logger.debug({ msg: 'Failed to open browser', error: error.message })
    }
  })
}

/**
 * Signs a text message using the Solana off-chain message standard.
 * Supports both Ledger hardware wallets and file-based keypairs.
 */
export async function signForSubscription(
  wallet: WalletInterface,
  message: string,
): Promise<Buffer> {
  const programIdentifier = getCliContext().programId.toBase58()
  if (wallet instanceof LedgerWallet) {
    return wallet.signOffchainMessage(message, programIdentifier)
  }
  if ('keypair' in wallet) {
    return signOffchainMessage(
      message,
      (wallet as KeypairWallet).keypair,
      programIdentifier,
    )
  }
  throw new CliCommandError({
    valueName: 'authority',
    value: wallet.publicKey.toBase58(),
    msg: 'Cannot sign off-chain message: provide a keypair file or Ledger wallet as authority',
  })
}

export function configureSubscribe(program: Command): Command {
  return program
    .command('subscribe')
    .description(
      'Subscribe to bond notifications. ' +
        'Requires signing with bond authority or validator identity keypair.',
    )
    .argument(
      '<bond-or-vote>',
      'Address of the bond account or vote account.',
      parsePubkey,
    )
    .requiredOption(
      '--type <type>',
      'Notification delivery type: telegram, email',
    )
    .requiredOption(
      '--address <address>',
      'Destination address for the notification type (Telegram handle, email address)',
    )
    .option(
      '--authority <keypair-or-ledger>',
      'Keypair to sign the subscription message (bond authority or validator identity). ' +
        '(default: wallet keypair)',
      parseWalletOrPubkeyOption,
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
    .addOption(
      new Option(
        '--no-browser',
        'Do not open browser for Telegram deep link',
      ).hideHelp(),
    )
}

export async function manageSubscribe({
  address,
  config,
  authority,
  type,
  channelAddress,
  notificationsApiUrl,
  browser = true,
}: {
  address: PublicKey
  config: PublicKey
  authority?: WalletInterface | PublicKey
  type: string
  channelAddress: string
  notificationsApiUrl: string
  browser?: boolean
}) {
  const { program, logger, wallet } = getCliContext()

  const bondAccountData = await getBondFromAddress({
    program,
    address,
    config,
    logger,
  })
  const bondPubkey = bondAccountData.publicKey
  const voteAccount = bondAccountData.account.data.voteAccount
  const configAddress = bondAccountData.account.data.config

  // Determine signing wallet
  if (authority && !instanceOfWallet(authority)) {
    throw new CliCommandError({
      valueName: 'authority',
      value: authority.toBase58(),
      msg: 'Cannot sign subscription message: provide a keypair file or Ledger wallet as --authority, not a public key',
    })
  }
  const signingWallet = authority ?? wallet
  if (!instanceOfWallet(signingWallet)) {
    throw new CliCommandError({
      valueName: 'authority',
      value: String(signingWallet),
      msg: 'Cannot sign subscription message: provide a keypair file or Ledger wallet as --authority',
    })
  }

  const timestamp = Math.floor(Date.now() / 1000)
  const messageText = subscribeMessage(
    NOTIFICATION_TYPE_SAM_AUCTION,
    type,
    timestamp,
  )

  logger.info(
    `Signing subscription message for bond ${bondPubkey.toBase58()} ` +
      `(vote account: ${voteAccount.toBase58()}) by ${signingWallet.publicKey.toBase58()}`,
  )

  const signature = await signForSubscription(signingWallet, messageText)
  const signatureBase58 = bs58.encode(signature)

  const request = {
    pubkey: signingWallet.publicKey.toBase58(),
    notification_type: NOTIFICATION_TYPE_SAM_AUCTION,
    channel: type,
    channel_address: channelAddress,
    signature: signatureBase58,
    message: messageText,
    additional_data: {
      config_address: configAddress.toBase58(),
      vote_account: voteAccount.toBase58(),
      bond_pubkey: bondPubkey.toBase58(),
    },
  }

  const client = createSubscriptionClient({
    base_url: notificationsApiUrl,
    logger,
  })

  try {
    const result = await client.subscribe(request)
    const bondLabel =
      `bond ${bondPubkey.toBase58()} ` +
      `(vote account: ${voteAccount.toBase58()})`

    if (type === 'telegram') {
      logTelegramResult(result, bondLabel, logger, browser)
    } else {
      logger.info(
        `Successfully subscribed to ${type} notifications ` +
          `with ${channelAddress} for ${bondLabel}`,
      )
    }
  } catch (e) {
    if (e instanceof NetworkError) {
      throw new CliCommandError({
        valueName: 'subscribe',
        value: e.status ? `HTTP ${e.status}` : 'connection error',
        msg: `Subscription failed: ${e.message}`,
      })
    }
    throw e
  }
}

function logTelegramResult(
  result: SubscribeResponse,
  bondLabel: string,
  logger: LoggerWrapper,
  browser: boolean,
): void {
  const tgStatus = result.telegram_status as string | undefined
  if (tgStatus === 'already_activated') {
    logger.info(
      `Telegram notifications are already active for ${bondLabel}` +
        ' — no action needed.',
    )
    return
  }

  if (tgStatus === 'bot_not_configured') {
    logger.warn(
      `Subscription created for ${bondLabel} but Telegram bot` +
        ' is not configured on the server.' +
        ' Notifications will not be delivered until the bot' +
        ' is set up. Please contact support.',
    )
    return
  }

  if (typeof result.deep_link === 'string') {
    logger.info(
      `Subscription created for ${bondLabel},` +
        ` confirming at ${result.deep_link}`,
    )
    if (browser) {
      openUrl(result.deep_link, logger)
      logger.info(
        'Opening Telegram in your browser to complete activation.' +
          ' Press Start in the bot to confirm.',
      )
    }
    return
  }

  logger.info(
    `Successfully subscribed to telegram notifications for ${bondLabel}`,
  )
}
