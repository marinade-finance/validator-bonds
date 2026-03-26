import {
  configureShowNotifications,
  showNotifications,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'
import { parsePubkey } from '@marinade.finance/web3js-1x'

import type { FormatType } from '@marinade.finance/cli-common'
import type { PublicKey } from '@solana/web3.js'
import type { Command } from 'commander'

export function installShowNotifications(program: Command) {
  configureShowNotifications(program)
    .option(
      '--config <pubkey>',
      'The config account that the bond account is created under ' +
        '(optional; to derive bond address from vote account address) ' +
        `(default: ${MARINADE_CONFIG_ADDRESS.toBase58()})`,
      parsePubkey,
    )
    .action(
      async (
        address: Promise<PublicKey>,
        {
          config,
          format,
          notificationsApiUrl,
          priority,
          innerType,
          limit,
        }: {
          config?: Promise<PublicKey>
          format: FormatType
          notificationsApiUrl: string
          priority?: string
          innerType?: string
          limit: string
        },
      ) => {
        await showNotifications({
          address: await address,
          config: (await config) ?? MARINADE_CONFIG_ADDRESS,
          format,
          notificationsApiUrl,
          priority,
          innerType,
          limit: parseInt(limit, 10),
        })
      },
    )
}
