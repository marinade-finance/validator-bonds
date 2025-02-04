import { parsePubkey } from '@marinade.finance/cli-common'
import { Command } from 'commander'
import {
  configureFundBond,
  manageFundBond,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
import { PublicKey } from '@solana/web3.js'

export function installFundBond(program: Command) {
  configureFundBond(program)
    .option(
      '--config <pubkey>',
      'The config account that the bond account is created under ' +
        '(optional; to derive bond address from vote account address) ' +
        `(default: ${MARINADE_CONFIG_ADDRESS.toBase58()})`,
      parsePubkey,
    )
    .action(
      async (
        address: Promise<PublicKey>,
        {
          config,
          stakeAccount,
          stakeAuthority,
        }: {
          config?: Promise<PublicKey>
          stakeAccount: Promise<PublicKey>
          stakeAuthority?: Promise<WalletInterface | PublicKey>
        },
      ) => {
        await manageFundBond({
          address: await address,
          config: await config,
          stakeAccount: await stakeAccount,
          stakeAuthority: await stakeAuthority,
        })
      },
    )
}
