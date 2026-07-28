import {
  configureRefundBondBalance,
  manageRefundBondBalance,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'
import { parsePubkey } from '@marinade.finance/web3js-1x'

import type { PublicKey } from '@solana/web3.js'
import type { Command } from 'commander'

export function installRefundBondBalance(program: Command) {
  configureRefundBondBalance(program)
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
          computeUnitLimit,
        }: {
          config?: Promise<PublicKey>
          stakeAccount?: Promise<PublicKey>
          computeUnitLimit: number
        },
      ) => {
        await manageRefundBondBalance({
          address: await address,
          config: await config,
          stakeAccount: await stakeAccount,
          computeUnitLimit,
        })
      },
    )
}
