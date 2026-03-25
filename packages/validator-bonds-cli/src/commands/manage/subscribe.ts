import {
  configureSubscribe,
  manageSubscribe,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'
import { parsePubkey } from '@marinade.finance/web3js-1x'

import type { Wallet as WalletInterface } from '@marinade.finance/web3js-1x'
import type { PublicKey } from '@solana/web3.js'
import type { Command } from 'commander'

export function installSubscribe(program: Command) {
  configureSubscribe(program)
    .option(
      '--config <pubkey>',
      'The config account that the bond account is created under ' +
        '(optional; to derive bond address from vote account address) ' +
        `(default: ${MARINADE_CONFIG_ADDRESS.toBase58()})`,
      parsePubkey,
    )
    .action(
      async (
        bondOrVoteAddress: Promise<PublicKey>,
        {
          config,
          authority,
          type,
          address: channelAddress,
          notificationsApiUrl,
          browser,
        }: {
          config?: Promise<PublicKey>
          authority?: Promise<WalletInterface | PublicKey>
          type: string
          address: string
          notificationsApiUrl: string
          browser: boolean
        },
      ) => {
        await manageSubscribe({
          address: await bondOrVoteAddress,
          config: (await config) ?? MARINADE_CONFIG_ADDRESS,
          authority: await authority,
          type,
          channelAddress,
          notificationsApiUrl,
          browser,
        })
      },
    )
}
