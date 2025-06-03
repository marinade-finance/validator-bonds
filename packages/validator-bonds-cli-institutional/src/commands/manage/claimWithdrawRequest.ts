import { Command } from 'commander'
import {
  configureClaimWithdrawRequest,
  manageClaimWithdrawRequest,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_INSTITUTIONAL_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
import { PublicKey } from '@solana/web3.js'

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
      }: {
        voteAccount?: Promise<PublicKey>
        authority?: Promise<WalletInterface | PublicKey>
        withdrawer?: Promise<PublicKey>
        splitStakeRentPayer?: Promise<WalletInterface | PublicKey>
        stakeAccount?: Promise<PublicKey>
      },
    ) => {
      await manageClaimWithdrawRequest({
        address: await address,
        config: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
        voteAccount: await voteAccount,
        authority: await authority,
        withdrawer: await withdrawer,
        splitStakeRentPayer: await splitStakeRentPayer,
        stakeAccount: await stakeAccount,
      })
    },
  )
}
