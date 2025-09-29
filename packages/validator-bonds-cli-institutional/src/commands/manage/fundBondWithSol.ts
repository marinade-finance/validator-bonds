import {
  configureFundBondWithSol,
  manageFundBondWithSol,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_INSTITUTIONAL_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'

import type { Wallet as WalletInterface } from '@marinade.finance/web3js-1x'
import type { PublicKey } from '@solana/web3.js'
import type { Command } from 'commander'

export function installFundBondWithSol(program: Command) {
  configureFundBondWithSol(program).action(
    async (
      address: Promise<PublicKey>,
      {
        amount,
        from,
        computeUnitLimit,
      }: {
        amount: number
        from?: Promise<WalletInterface | PublicKey>
        computeUnitLimit: number
      },
    ) => {
      await manageFundBondWithSol({
        address: await address,
        config: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
        amount,
        from: await from,
        computeUnitLimit,
      })
    },
  )
}
