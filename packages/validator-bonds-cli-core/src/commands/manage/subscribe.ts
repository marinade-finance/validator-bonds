import { CliCommandError } from '@marinade.finance/cli-common'
import {
  LedgerWallet,
  signOffchainMessage,
} from '@marinade.finance/ledger-utils'
import {
  instanceOfWallet,
  parsePubkey,
  parseWalletOrPubkeyOption,
} from '@marinade.finance/web3js-1x'
import bs58 from 'bs58'
import { Option } from 'commander'

import { getCliContext } from '../../context'
import { getBondFromAddress } from '../../utils'

import type { KeypairWallet } from '@marinade.finance/web3js-1x'
import type { Wallet as WalletInterface } from '@marinade.finance/web3js-1x'
import type { PublicKey } from '@solana/web3.js'
import type { Command } from 'commander'

export const NOTIFICATIONS_API_URL_ENV = 'NOTIFICATIONS_API_URL'
export const NOTIFICATIONS_API_URL_DEFAULT =
  'https://notifications-api.marinade.finance'

/**
 * Signs a text message using the Solana off-chain message standard.
 * Supports both Ledger hardware wallets and file-based keypairs.
 */
export async function signForSubscription(
  wallet: WalletInterface,
  message: string,
): Promise<Buffer> {
  getCliContext().programId.toBase58()
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
}

export async function manageSubscribe({
  address,
  config,
  authority,
  type,
  channelAddress,
  notificationsApiUrl,
}: {
  address: PublicKey
  config: PublicKey
  authority?: WalletInterface | PublicKey
  type: string
  channelAddress: string
  notificationsApiUrl: string
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
  const signingWallet =
    authority && instanceOfWallet(authority) ? authority : wallet
  if (!instanceOfWallet(signingWallet)) {
    throw new CliCommandError({
      valueName: 'authority',
      value: String(signingWallet),
      msg: 'Cannot sign subscription message: provide a keypair file or Ledger wallet as --authority',
    })
  }

  const timestamp = Math.floor(Date.now() / 1000)
  const messageText = `Subscribe bonds ${type} ${timestamp}`

  logger.info(
    `Signing subscription message for bond ${bondPubkey.toBase58()} ` +
      `(vote account: ${voteAccount.toBase58()}) by ${signingWallet.publicKey.toBase58()}`,
  )

  const signature = await signForSubscription(signingWallet, messageText)
  const signatureBase58 = bs58.encode(signature)

  const body = {
    pubkey: signingWallet.publicKey.toBase58(),
    notification_type: 'bonds',
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

  const url = `${notificationsApiUrl}/subscriptions`
  logger.debug(`POST ${url} with body: ${JSON.stringify(body)}`)

  const response = await fetchNotificationsApi(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new CliCommandError({
      valueName: 'subscribe',
      value: `HTTP ${response.status}`,
      msg: `Subscription failed: ${errorText}`,
    })
  }

  const result: Record<string, unknown> = (await response.json()) as Record<
    string,
    unknown
  >

  // For telegram, the API may return a deep link URL
  if (type === 'telegram' && typeof result.deep_link === 'string') {
    logger.info(
      `Subscription created for bond ${bondPubkey.toBase58()} (vote account: ${voteAccount.toBase58()})`,
    )
    logger.warn(
      `\n>>> ACTION REQUIRED: Open this link in your browser to activate Telegram notifications <<<\n\n    ${result.deep_link}\n`,
    )
  } else {
    logger.info(
      `Successfully subscribed to ${type} notifications with ${channelAddress} for bond ${bondPubkey.toBase58()} ` +
        `(vote account: ${voteAccount.toBase58()})`,
    )
  }
}

/**
 * Wrapper around fetch that converts connection errors into descriptive CLI errors.
 */
export async function fetchNotificationsApi(
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (e) {
    throw new CliCommandError({
      valueName: 'notifications-api-url',
      value: url,
      msg:
        `Cannot connect to notification service at ${url}. ` +
        `Is the service running? (${e instanceof Error ? e.message : String(e)})`,
    })
  }
}
