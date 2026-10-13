import {
  configureRefundBondBalance,
  manageRefundBondBalance,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_INSTITUTIONAL_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'

import type { PublicKey } from '@solana/web3.js'
import type { Command } from 'commander'

export function installRefundBondBalance(program: Command) {
  configureRefundBondBalance(program).action(
    async (
      address: Promise<PublicKey>,
      {
        stakeAccount,
        computeUnitLimit,
      }: {
        stakeAccount?: Promise<PublicKey>
        computeUnitLimit: number
      },
    ) => {
      await manageRefundBondBalance({
        address: await address,
        config: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
        stakeAccount: await stakeAccount,
        computeUnitLimit,
      })
    },
  )
}
