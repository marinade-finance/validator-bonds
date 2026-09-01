import { exec } from 'child_process'

import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes'
import { CliCommandError } from '@marinade.finance/cli-common'
import {
  LedgerWallet,
  signOffchainMessage,
} from '@marinade.finance/ledger-utils'
import {
  createSubscriptionClient,
  subscribeMessage,
} from '@marinade.finance/notifications-ts-subscription-client'
import {
  bondAddress,
  MARINADE_CONFIG_ADDRESS,
  MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
} from '@marinade.finance/validator-bonds-sdk'
import {
  instanceOfWallet,
  parsePubkey,
  parseWalletOrPubkeyOption,
} from '@marinade.finance/web3js-1x'
import { Option } from 'commander'

import { withConfigOption } from './config-option'
import { getCliContext } from '../../context'
import { formatHttpError, getBondFromAddress } from '../../utils'

import type { SubscribeResponse } from '@marinade.finance/notifications-ts-subscription-client'
import type { LoggerWrapper } from '@marinade.finance/ts-common'
import type { ValidatorBondsProgram } from '@marinade.finance/validator-bonds-sdk'
import type { KeypairWallet } from '@marinade.finance/web3js-1x'
import type { Wallet as WalletInterface } from '@marinade.finance/web3js-1x'
import type { PublicKey } from '@solana/web3.js'
import type { Command } from 'commander'

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
        '--no-browser',
        'Do not open browser for Telegram deep link',
      ).hideHelp(),
    )
}

export function installSubscribe(
  program: Command,
  defaultConfigAddress: PublicKey,
) {
  withConfigOption(configureSubscribe(program), defaultConfigAddress).action(
    async (
      bondOrVoteAddress: Promise<PublicKey>,
      {
        config,
        authority,
        type,
        address: channelAddress,
        browser,
      }: {
        config?: Promise<PublicKey>
        authority?: Promise<WalletInterface | PublicKey>
        type: string
        address: string
        browser: boolean
      },
    ) => {
      await manageSubscribe({
        address: await bondOrVoteAddress,
        config: (await config) ?? defaultConfigAddress,
        authority: await authority,
        type,
        channelAddress,
        browser,
      })
    },
  )
}

export async function manageSubscribe({
  address,
  config,
  authority,
  type,
  channelAddress,
  browser = true,
}: {
  address: PublicKey
  config: PublicKey
  authority?: WalletInterface | PublicKey
  type: string
  channelAddress: string
  browser?: boolean
}) {
  const { program, logger, wallet, notificationsApiUrl, notificationType } =
    getCliContext()

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
  const messageText = subscribeMessage(notificationType, type, timestamp)

  logger.info(
    `Signing subscription message for bond ${bondPubkey.toBase58()} ` +
      `(vote account: ${voteAccount.toBase58()}) by ${signingWallet.publicKey.toBase58()}`,
  )

  const signature = await signForSubscription(signingWallet, messageText)
  const signatureBase58 = bs58.encode(signature)

  const request = {
    pubkey: signingWallet.publicKey.toBase58(),
    notification_type: notificationType,
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
    const httpMsg = formatHttpError(e, notificationsApiUrl)
    if (httpMsg) {
      throw new CliCommandError({
        valueName: 'subscribe',
        value: 'network error',
        msg: `Subscription failed. ${httpMsg}`,
      })
    }
    throw e
  }

  // Outside the try above so it can never be reported as a subscription failure
  await warnAboutOtherBondType({
    program,
    logger,
    configAddress,
    voteAccount,
    type,
    channelAddress,
    withAuthority: authority !== undefined,
  })
}

// each CLI owns one notification type, so a vote account with both bonds needs both subscriptions
async function warnAboutOtherBondType({
  program,
  logger,
  configAddress,
  voteAccount,
  type,
  channelAddress,
  withAuthority,
}: {
  program: ValidatorBondsProgram
  logger: LoggerWrapper
  configAddress: PublicKey
  voteAccount: PublicKey
  type: string
  channelAddress: string
  withAuthority: boolean
}): Promise<void> {
  try {
    const other = otherBondConfig(configAddress)
    if (other === null) {
      return
    }
    const [otherBond] = bondAddress(
      other.config,
      voteAccount,
      program.programId,
    )
    const accountInfo =
      await program.provider.connection.getAccountInfo(otherBond)
    if (accountInfo === null || !accountInfo.owner.equals(program.programId)) {
      return
    }
    logger.warn(
      `This vote account also has a ${other.label} bond ` +
        `(${otherBond.toBase58()}). Its notifications are subscribed ` +
        `separately: ${other.cli} subscribe ${voteAccount.toBase58()}` +
        ` --type ${type} --address ${channelAddress}` +
        (withAuthority ? ' --authority <keypair-or-ledger>' : ''),
    )
  } catch (e) {
    logger.debug({
      msg: 'could not check for a bond of the other type',
      error: e instanceof Error ? e.message : String(e),
    })
  }
}

export function otherBondConfig(
  configAddress: PublicKey,
): { config: PublicKey; label: string; cli: string } | null {
  if (configAddress.equals(MARINADE_CONFIG_ADDRESS)) {
    return {
      config: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
      label: 'Marinade Select',
      cli: 'validator-bonds-institutional',
    }
  }
  if (configAddress.equals(MARINADE_INSTITUTIONAL_CONFIG_ADDRESS)) {
    return {
      config: MARINADE_CONFIG_ADDRESS,
      label: 'bidding',
      cli: 'validator-bonds',
    }
  }
  return null
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
    logger.info(
      "The subscription is reported as 'pending' until the first notification" +
        " is delivered, then it turns to 'active'." +
        ' Pressing Start is enough, no further action is needed.',
    )
    return
  }

  logger.warn(
    `Subscription created for ${bondLabel} but the server returned no` +
      ' Telegram activation link. Notifications cannot be delivered until' +
      ' the subscription is activated. Please contact support.',
  )
}
