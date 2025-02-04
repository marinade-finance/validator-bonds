import { parsePubkey } from '@marinade.finance/cli-common'
import { Command } from 'commander'
import {
  configureInitWithdrawRequest,
  manageInitWithdrawRequest,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
import { PublicKey } from '@solana/web3.js'

export function installInitWithdrawRequest(program: Command) {
  configureInitWithdrawRequest(program)
    .option(
      '--config <pubkey>',
      '(optional when the argument "address" is NOT provided, used to derive the bond address) ' +
        `The config account that the bond is created under (default: ${MARINADE_CONFIG_ADDRESS.toBase58()})`,
      parsePubkey,
    )
    .action(
      async (
        address: Promise<PublicKey | undefined>,
        {
          config,
          voteAccount,
          authority,
          amount,
          rentPayer,
        }: {
          config?: Promise<PublicKey>
          voteAccount?: Promise<PublicKey>
          authority?: Promise<WalletInterface | PublicKey>
          amount: string
          rentPayer?: Promise<WalletInterface | PublicKey>
        },
      ) => {
        await manageInitWithdrawRequest({
          address: await address,
          config: (await config) ?? MARINADE_CONFIG_ADDRESS,
          voteAccount: await voteAccount,
          authority: await authority,
          amount,
          rentPayer: await rentPayer,
        })
      },
    )
}
