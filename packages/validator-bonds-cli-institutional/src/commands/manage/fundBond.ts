import { Command } from 'commander'
import {
  configureFundBond,
  manageFundBond,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_INSTITUTIONAL_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
import { PublicKey } from '@solana/web3.js'

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
      },
    ) => {
      await manageFundBond({
        address: await address,
        config: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
        stakeAccount: await stakeAccount,
        stakeAuthority: await stakeAuthority,
        computeUnitLimit,
      })
    },
  )
}
