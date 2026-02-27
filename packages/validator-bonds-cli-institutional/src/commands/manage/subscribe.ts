import {
  configureSubscribe,
  manageSubscribe,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_INSTITUTIONAL_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'

import type { Wallet as WalletInterface } from '@marinade.finance/web3js-1x'
import type { PublicKey } from '@solana/web3.js'
import type { Command } from 'commander'

export function installSubscribe(program: Command) {
  configureSubscribe(program).action(
    async (
      address: Promise<PublicKey>,
      {
        authority,
        type,
        address: channelAddress,
        notificationsApiUrl,
      }: {
        authority?: Promise<WalletInterface | PublicKey>
        type: string
        address: string
        notificationsApiUrl: string
      },
    ) => {
      await manageSubscribe({
        address: await address,
        config: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
        authority: await authority,
        type,
        channelAddress,
        notificationsApiUrl,
      })
    },
  )
}
