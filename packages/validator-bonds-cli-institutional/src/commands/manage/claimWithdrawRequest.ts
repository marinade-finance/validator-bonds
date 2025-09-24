import {
  configureClaimWithdrawRequest,
  manageClaimWithdrawRequest,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_INSTITUTIONAL_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'

import type { Wallet as WalletInterface } from '@marinade.finance/web3js-1x'
import type { PublicKey } from '@solana/web3.js'
import type { Command } from 'commander'

export function installClaimWithdrawRequest(program: Command) {
  configureClaimWithdrawRequest(program).action(
    async (
      address: Promise<PublicKey | undefined>,
      {
        voteAccount,
        authority,
        withdrawer,
        splitStakeRentPayer,
        stakeAccount,
        computeUnitLimit,
      }: {
        voteAccount?: Promise<PublicKey>
        authority?: Promise<WalletInterface | PublicKey>
        withdrawer?: Promise<PublicKey>
        splitStakeRentPayer?: Promise<WalletInterface | PublicKey>
        stakeAccount?: Promise<PublicKey>
        computeUnitLimit: number
      }
    ) => {
      await manageClaimWithdrawRequest({
        address: await address,
        config: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
        voteAccount: await voteAccount,
        authority: await authority,
        withdrawer: await withdrawer,
        splitStakeRentPayer: await splitStakeRentPayer,
        stakeAccount: await stakeAccount,
        computeUnitLimit,
      })
    }
  )
}
