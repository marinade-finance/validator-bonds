import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes'
import { CliCommandError } from '@marinade.finance/cli-common'
import {
  instanceOfWallet,
  parsePubkey,
  parseWalletOrPubkeyOption,
} from '@marinade.finance/web3js-1x'
import { Option } from 'commander'

import {
  NOTIFICATIONS_API_URL_DEFAULT,
  NOTIFICATIONS_API_URL_ENV,
  fetchNotificationsApi,
  signForSubscription,
} from './subscribe'
import { getCliContext } from '../../context'
import { getBondFromAddress } from '../../utils'

import type { Wallet as WalletInterface } from '@marinade.finance/web3js-1x'
import type { PublicKey } from '@solana/web3.js'
import type { Command } from 'commander'

export function configureUnsubscribe(program: Command): Command {
  return program
    .command('unsubscribe')
    .description(
      'Unsubscribe from bond notifications. ' +
        'Requires signing with bond authority or validator identity keypair.',
    )
    .argument(
      '<bond-or-vote>',
      'Address of the bond account or vote account.',
      parsePubkey,
    )
    .requiredOption(
      '--type <type>',
      'Notification delivery type to unsubscribe from: telegram, email',
    )
    .option(
      '--address <address>',
      'Destination address to unsubscribe (Telegram handle, email address). ' +
        'When not provided, all subscriptions of the given type are removed.',
    )
    .option(
      '--authority <keypair-or-ledger>',
      'Keypair to sign the unsubscribe message (bond authority or validator identity). ' +
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

export async function manageUnsubscribe({
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
  channelAddress?: string
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

  if (authority && !instanceOfWallet(authority)) {
    throw new CliCommandError({
      valueName: 'authority',
      value: authority.toBase58(),
      msg: 'Cannot sign unsubscribe message: provide a keypair file or Ledger wallet as --authority, not a public key',
    })
  }
  const signingWallet = authority ?? wallet
  if (!instanceOfWallet(signingWallet)) {
    throw new CliCommandError({
      valueName: 'authority',
      value: String(signingWallet),
      msg: 'Cannot sign unsubscribe message: provide a keypair file or Ledger wallet as --authority',
    })
  }

  const timestamp = Math.floor(Date.now() / 1000)
  const messageText = `Unsubscribe bonds ${type} ${timestamp}`

  logger.info(
    `Signing unsubscribe message for bond ${bondPubkey.toBase58()} ` +
      `(vote account: ${voteAccount.toBase58()}) by ${signingWallet.publicKey.toBase58()}`,
  )

  const signature = await signForSubscription(signingWallet, messageText)
  const signatureBase58 = bs58.encode(signature)

  const body: Record<string, unknown> = {
    pubkey: signingWallet.publicKey.toBase58(),
    notification_type: 'bonds',
    channel: type,
    signature: signatureBase58,
    message: messageText,
    additional_data: {
      config_address: configAddress.toBase58(),
      vote_account: voteAccount.toBase58(),
      bond_pubkey: bondPubkey.toBase58(),
    },
  }
  if (channelAddress) {
    body.channel_address = channelAddress
  }

  const url = `${notificationsApiUrl}/subscriptions`
  const redactedBody = {
    ...body,
    signature: '[redacted]',
  }
  logger.debug(`DELETE ${url} with body: ${JSON.stringify(redactedBody)}`)

  const response = await fetchNotificationsApi(url, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new CliCommandError({
      valueName: 'unsubscribe',
      value: `HTTP ${response.status}`,
      msg: `Unsubscribe failed: ${errorText}`,
    })
  }

  const target = channelAddress ? `${type}:${channelAddress}` : `all ${type}`
  logger.info(
    `Successfully unsubscribed from ${target} notifications for bond ${bondPubkey.toBase58()} ` +
      `(vote account: ${voteAccount.toBase58()})`,
  )
}
