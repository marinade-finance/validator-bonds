import {
  configureShowNotifications,
  showNotifications,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_INSTITUTIONAL_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'

import type { FormatType } from '@marinade.finance/cli-common'
import type { Wallet as WalletInterface } from '@marinade.finance/web3js-1x'
import type { PublicKey } from '@solana/web3.js'
import type { Command } from 'commander'

export function installShowNotifications(program: Command) {
  configureShowNotifications(program).action(
    async (
      address: Promise<PublicKey>,
      {
        authority,
        format,
        notificationsApiUrl,
      }: {
        authority?: Promise<WalletInterface | PublicKey>
        format: FormatType
        notificationsApiUrl: string
      },
    ) => {
      await showNotifications({
        address: await address,
        config: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
        authority: await authority,
        format,
        notificationsApiUrl,
      })
    },
  )
}
