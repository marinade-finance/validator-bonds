import { Command } from 'commander'
import {
  configureInitWithdrawRequest,
  manageInitWithdrawRequest,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_INSTITUTIONAL_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
import { PublicKey } from '@solana/web3.js'

export function installInitWithdrawRequest(program: Command) {
  configureInitWithdrawRequest(program).action(
    async (
      address: Promise<PublicKey | undefined>,
      {
        voteAccount,
        authority,
        amount,
        rentPayer,
      }: {
        voteAccount?: Promise<PublicKey>
        authority?: Promise<WalletInterface | PublicKey>
        amount: string
        rentPayer?: Promise<WalletInterface | PublicKey>
      },
    ) => {
      await manageInitWithdrawRequest({
        address: await address,
        config: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
        voteAccount: await voteAccount,
        authority: await authority,
        amount,
        rentPayer: await rentPayer,
      })
    },
  )
}
