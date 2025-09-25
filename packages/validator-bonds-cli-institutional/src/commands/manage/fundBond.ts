import {
  configureFundBond,
  manageFundBond,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_INSTITUTIONAL_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'

import type { Wallet as WalletInterface } from '@marinade.finance/web3js-1x'
import type { PublicKey } from '@solana/web3.js'
import type { Command } from 'commander'

export function installFundBond(program: Command) {
  configureFundBond(program).action(
    async (
      address: Promise<PublicKey>,
      {
        stakeAccount,
        stakeAuthority,
        computeUnitLimit,
      }: {
        stakeAccount: Promise<PublicKey>
        stakeAuthority?: Promise<WalletInterface | PublicKey>
        computeUnitLimit: number
      }
    ) => {
      await manageFundBond({
        address: await address,
        config: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
        stakeAccount: await stakeAccount,
        stakeAuthority: await stakeAuthority,
        computeUnitLimit,
      })
    }
  )
}
