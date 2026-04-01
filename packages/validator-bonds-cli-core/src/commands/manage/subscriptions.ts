import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes'
import {
  CliCommandError,
  FORMAT_TYPE_DEF,
  printData,
} from '@marinade.finance/cli-common'
import {
  createSubscriptionClient,
  listSubscriptionsMessage,
} from '@marinade.finance/notifications-ts-subscription-client'
import {
  instanceOfWallet,
  parsePubkey,
  parseWalletOrPubkeyOption,
} from '@marinade.finance/web3js-1x'

import { signForSubscription } from './subscribe'
import { getCliContext } from '../../context'
import { formatHttpError, getBondFromAddress } from '../../utils'

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
    .option(
      `-f, --format <${FORMAT_TYPE_DEF.join('|')}>`,
      'Format of output',
      'text',
    )
}

export async function showSubscriptions({
  address,
  config,
  authority,
  format,
}: {
  address: PublicKey
  config: PublicKey
  authority?: WalletInterface | PublicKey
  format: FormatType
}) {
  const { program, logger, wallet, notificationsApiUrl, notificationType } =
    getCliContext()

  const bondAccountData = await getBondFromAddress({
    program,
    address,
    config,
    logger,
  })
  const voteAccount = bondAccountData.account.data.voteAccount
  const configAddress = bondAccountData.account.data.config
  const bondPubkey = bondAccountData.publicKey

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
        notification_type: notificationType,
        additional_data: {
          config_address: configAddress.toBase58(),
          vote_account: voteAccount.toBase58(),
          bond_pubkey: bondPubkey.toBase58(),
        },
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
    const httpMsg = formatHttpError(e, notificationsApiUrl)
    if (httpMsg) {
      throw new CliCommandError({
        valueName: 'subscriptions',
        value: 'network error',
        msg: `Failed to fetch subscriptions. ${httpMsg}`,
      })
    }
    throw e
  }
}
