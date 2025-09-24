import { Command } from 'commander'
import {
  configureCancelWithdrawRequest,
  manageCancelWithdrawRequest,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_INSTITUTIONAL_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-1x'
import { PublicKey } from '@solana/web3.js'

export function installCancelWithdrawRequest(program: Command) {
  configureCancelWithdrawRequest(program).action(
    async (
      address: Promise<PublicKey | undefined>,
      {
        voteAccount,
        authority,
        rentCollector,
        computeUnitLimit,
      }: {
        voteAccount?: Promise<PublicKey>
        authority?: Promise<WalletInterface | PublicKey>
        rentCollector?: Promise<PublicKey>
        computeUnitLimit: number
      },
    ) => {
      await manageCancelWithdrawRequest({
        address: await address,
        config: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
        voteAccount: await voteAccount,
        authority: await authority,
        rentCollector: await rentCollector,
        computeUnitLimit,
      })
    },
  )
}
