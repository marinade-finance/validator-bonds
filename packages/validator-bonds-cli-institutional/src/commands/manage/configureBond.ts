import {
  configureConfigureBond,
  manageConfigureBond,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_INSTITUTIONAL_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'

import type { Wallet as WalletInterface } from '@marinade.finance/web3js-1x'
import type { PublicKey } from '@solana/web3.js'
import type BN from 'bn.js'
import type { Command } from 'commander'

export function installConfigureBond(program: Command) {
  configureConfigureBond(program).action(
    async (
      address: Promise<PublicKey>,
      {
        voteAccount,
        authority,
        withToken,
        bondAuthority,
        cpmpe,
        maxStakeWanted,
        computeUnitLimit,
      }: {
        voteAccount?: Promise<PublicKey>
        authority?: Promise<WalletInterface | PublicKey>
        withToken: boolean
        bondAuthority?: Promise<PublicKey>
        cpmpe?: BN
        maxStakeWanted?: BN
        computeUnitLimit?: number
      }
    ) => {
      await manageConfigureBond({
        address: await address,
        config: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
        voteAccount: await voteAccount,
        authority: await authority,
        withToken,
        newBondAuthority: await bondAuthority,
        cpmpe,
        maxStakeWanted,
        computeUnitLimit,
      })
    }
  )
}
