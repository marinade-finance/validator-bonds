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

/**
 * Application domain for off-chain message signing.
 * Uses the validator-bonds program ID per Solana best practice.
 */
export const BONDS_APP_DOMAIN = 'vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4'

const DEFAULT_NOTIFICATIONS_API_URL =
  'https://notifications-api.marinade.finance'

/**
 * Signs a text message using the Solana off-chain message standard.
 * Supports both Ledger hardware wallets and file-based keypairs.
 */
export async function signForSubscription(
  wallet: WalletInterface,
  message: string,
): Promise<Buffer> {
  if (wallet instanceof LedgerWallet) {
    return wallet.signOffchainMessage(message, BONDS_APP_DOMAIN)
  }
  if ('keypair' in wallet) {
    return signOffchainMessage(
      message,
      (wallet as KeypairWallet).keypair,
      BONDS_APP_DOMAIN,
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
        .env('NOTIFICATIONS_API_URL')
        .default(DEFAULT_NOTIFICATIONS_API_URL)
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
      `(vote account: ${voteAccount.toBase58()})`,
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
  logger.debug(`POST ${url}`)

  const response = await fetch(url, {
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
      `Subscription initiated! Complete setup by opening this link:\n  ${result.deep_link}`,
    )
  } else {
    logger.info(
      `Successfully subscribed to ${type} notifications for bond ${bondPubkey.toBase58()} ` +
        `(vote account: ${voteAccount.toBase58()})`,
    )
  }
}
