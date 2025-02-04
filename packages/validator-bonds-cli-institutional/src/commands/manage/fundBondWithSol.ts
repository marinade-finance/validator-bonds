import { Command } from 'commander'
import {
  configureFundBondWithSol,
  manageFundBondWithSol,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_INSTITUTIONAL_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
import { PublicKey } from '@solana/web3.js'

export function installFundBondWithSol(program: Command) {
  configureFundBondWithSol(program).action(
    async (
      address: Promise<PublicKey>,
      {
        amount,
        from,
      }: {
        amount: number
        from?: Promise<WalletInterface | PublicKey>
      },
    ) => {
      await manageFundBondWithSol({
        address: await address,
        config: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
        amount,
        from: await from,
      })
    },
  )
}
