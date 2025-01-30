import { parsePubkey } from '@marinade.finance/cli-common'
import { Command } from 'commander'
import {
  configureCancelWithdrawRequest,
  manageCancelWithdrawRequest,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
import { PublicKey } from '@solana/web3.js'

export function installCancelWithdrawRequest(program: Command) {
  configureCancelWithdrawRequest(program)
    .option(
      '--config <pubkey>',
      '(optional when the argument "address" is NOT provided, ' +
        'used to derive the withdraw request address) ' +
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
          rentCollector,
        }: {
          config?: Promise<PublicKey>
          voteAccount?: Promise<PublicKey>
          authority?: Promise<WalletInterface | PublicKey>
          rentCollector?: Promise<PublicKey>
        },
      ) => {
        await manageCancelWithdrawRequest({
          address: await address,
          config: (await config) ?? MARINADE_CONFIG_ADDRESS,
          voteAccount: await voteAccount,
          authority: await authority,
          rentCollector: await rentCollector,
        })
      },
    )
}
