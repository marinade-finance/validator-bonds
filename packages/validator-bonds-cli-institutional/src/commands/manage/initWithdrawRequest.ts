import {
  configureInitWithdrawRequest,
  manageInitWithdrawRequest,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_INSTITUTIONAL_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'

import type { Wallet as WalletInterface } from '@marinade.finance/web3js-1x'
import type { PublicKey } from '@solana/web3.js'
import type { Command } from 'commander'

export function installInitWithdrawRequest(program: Command) {
  configureInitWithdrawRequest(program).action(
    async (
      address: Promise<PublicKey | undefined>,
      {
        voteAccount,
        authority,
        amount,
        rentPayer,
        computeUnitLimit,
      }: {
        voteAccount?: Promise<PublicKey>
        authority?: Promise<WalletInterface | PublicKey>
        amount: string
        rentPayer?: Promise<WalletInterface | PublicKey>
        computeUnitLimit: number
      },
    ) => {
      await manageInitWithdrawRequest({
        address: await address,
        config: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
        voteAccount: await voteAccount,
        authority: await authority,
        amount,
        rentPayer: await rentPayer,
        computeUnitLimit,
      })
    },
  )
}
