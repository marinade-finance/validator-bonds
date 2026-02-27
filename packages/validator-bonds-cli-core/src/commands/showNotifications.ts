import { CliCommandError, printData } from '@marinade.finance/cli-common'
import {
  instanceOfWallet,
  parsePubkey,
  parseWalletOrPubkeyOption,
} from '@marinade.finance/web3js-1x'
import bs58 from 'bs58'
import { Option } from 'commander'

import { getCliContext } from '../context'
import { getBondFromAddress } from '../utils'
import { signForSubscription } from './manage/subscribe'

import type { FormatType } from '@marinade.finance/cli-common'
import type { Wallet as WalletInterface } from '@marinade.finance/web3js-1x'
import type { PublicKey } from '@solana/web3.js'
import type { Command } from 'commander'

const DEFAULT_NOTIFICATIONS_API_URL =
  'https://notifications-api.marinade.finance'

export function configureShowNotifications(program: Command): Command {
  return program
    .command('show-notifications')
    .description(
      'Show notification subscriptions for a bond. ' +
        'Requires signing with bond authority or validator identity keypair.',
    )
    .argument(
      '<bond-or-vote>',
      'Address of the bond account or vote account.',
      parsePubkey,
    )
    .option(
      '--authority <keypair-or-ledger>',
      'Keypair for authenticated request (bond authority or validator identity). ' +
        '(default: wallet keypair)',
      parseWalletOrPubkeyOption,
    )
    .option('-f, --format <format>', 'Output format: text, yaml, json', 'text')
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

export async function showNotifications({
  address,
  config,
  authority,
  format,
  notificationsApiUrl,
}: {
  address: PublicKey
  config: PublicKey
  authority?: WalletInterface | PublicKey
  format: FormatType
  notificationsApiUrl: string
}) {
  const { program, logger, wallet } = getCliContext()

  const bondAccountData = await getBondFromAddress({
    program,
    address,
    config,
    logger,
  })
  const voteAccount = bondAccountData.account.data.voteAccount

  const signingWallet =
    authority && instanceOfWallet(authority) ? authority : wallet
  if (!instanceOfWallet(signingWallet)) {
    throw new CliCommandError({
      valueName: 'authority',
      value: String(signingWallet),
      msg: 'Cannot sign list request: provide a keypair file or Ledger wallet as --authority',
    })
  }

  const timestamp = Math.floor(Date.now() / 1000)
  const messageText = `ListSubscriptions bonds ${timestamp}`

  const signature = await signForSubscription(signingWallet, messageText)
  const signatureBase58 = bs58.encode(signature)

  const pubkey = signingWallet.publicKey.toBase58()
  const params = new URLSearchParams({
    pubkey,
    notification_type: 'bonds',
  })
  const url = `${notificationsApiUrl}/subscriptions?${params.toString()}`
  logger.debug(`GET ${url}`)

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-solana-signature': signatureBase58,
      'x-solana-message': messageText,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new CliCommandError({
      valueName: 'show-notifications',
      value: `HTTP ${response.status}`,
      msg: `Failed to fetch subscriptions: ${errorText}`,
    })
  }

  const data: unknown = await response.json()

  if (Array.isArray(data) && data.length === 0) {
    logger.info(
      `No notification subscriptions found for vote account ${voteAccount.toBase58()}`,
    )
    return
  }

  printData(
    {
      voteAccount: voteAccount.toBase58(),
      subscriptions: data as Record<string, unknown>[],
    },
    format,
  )
}
