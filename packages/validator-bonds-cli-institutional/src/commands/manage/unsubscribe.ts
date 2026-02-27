import {
  configureUnsubscribe,
  manageUnsubscribe,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_INSTITUTIONAL_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'

import type { Wallet as WalletInterface } from '@marinade.finance/web3js-1x'
import type { PublicKey } from '@solana/web3.js'
import type { Command } from 'commander'

export function installUnsubscribe(program: Command) {
  configureUnsubscribe(program).action(
    async (
      address: Promise<PublicKey>,
      {
        authority,
        type,
        notificationsApiUrl,
      }: {
        authority?: Promise<WalletInterface | PublicKey>
        type: string
        notificationsApiUrl: string
      },
    ) => {
      await manageUnsubscribe({
        address: await address,
        config: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
        authority: await authority,
        type,
        notificationsApiUrl,
      })
    },
  )
}
