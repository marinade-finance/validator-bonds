import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes'
import { CliCommandError, printData } from '@marinade.finance/cli-common'
import {
  createSubscriptionClient,
  listSubscriptionsMessage,
  NetworkError,
} from '@marinade.finance/ts-subscription-client'
import {
  instanceOfWallet,
  parsePubkey,
  parseWalletOrPubkeyOption,
} from '@marinade.finance/web3js-1x'
import { Option } from 'commander'

import {
  NOTIFICATIONS_API_URL_DEFAULT,
  NOTIFICATIONS_API_URL_ENV,
  signForSubscription,
} from './subscribe'
import { getCliContext } from '../../context'
import { getBondFromAddress } from '../../utils'

import type { FormatType } from '@marinade.finance/cli-common'
import type { Wallet as WalletInterface } from '@marinade.finance/web3js-1x'
import type { PublicKey } from '@solana/web3.js'
import type { Command } from 'commander'

export function configureSubscriptions(program: Command): Command {
  return program
    .command('subscriptions')
    .description(
      'Show subscriptions to bond notifications. ' +
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
        .env(NOTIFICATIONS_API_URL_ENV)
        .default(NOTIFICATIONS_API_URL_DEFAULT)
        .hideHelp(),
    )
}

export async function showSubscriptions({
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

  if (authority && !instanceOfWallet(authority)) {
    throw new CliCommandError({
      valueName: 'authority',
      value: authority.toBase58(),
      msg: 'Cannot sign list request: provide a keypair file or Ledger wallet as --authority, not a public key',
    })
  }
  const signingWallet = authority ?? wallet
  if (!instanceOfWallet(signingWallet)) {
    throw new CliCommandError({
      valueName: 'authority',
      value: String(signingWallet),
      msg: 'Cannot sign list request: provide a keypair file or Ledger wallet as --authority',
    })
  }

  const pubkey = signingWallet.publicKey.toBase58()
  const timestamp = Math.floor(Date.now() / 1000)
  const messageText = listSubscriptionsMessage(pubkey, timestamp)

  const signature = await signForSubscription(signingWallet, messageText)
  const signatureBase58 = bs58.encode(signature)

  const client = createSubscriptionClient({
    base_url: notificationsApiUrl,
    logger,
  })

  try {
    const data = await client.listSubscriptions(
      {
        pubkey,
        notification_type: 'bonds',
      },
      {
        signature: signatureBase58,
        message: messageText,
      },
    )

    if (data.length === 0) {
      logger.info(
        `No notification subscriptions found for vote account ${voteAccount.toBase58()}`,
      )
      return
    }

    printData(
      {
        voteAccount: voteAccount.toBase58(),
        subscriptions: data as unknown as Record<string, unknown>[],
      },
      format,
    )
  } catch (e) {
    if (e instanceof NetworkError) {
      throw new CliCommandError({
        valueName: 'subscriptions',
        value: e.status ? `HTTP ${e.status}` : 'connection error',
        msg: `Failed to fetch subscriptions: ${e.message}`,
      })
    }
    throw e
  }
}
