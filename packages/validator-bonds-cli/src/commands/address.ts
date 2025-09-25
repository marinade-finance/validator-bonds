import {
  configureShowBondAddress,
  showBondAddress,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'
import { parsePubkey } from '@marinade.finance/web3js-1x'

import type { PublicKey } from '@solana/web3.js'
import type { Command } from 'commander'

export function installShowBondAddress(command: Command) {
  const program = configureShowBondAddress(command)
  program
    .option(
      '--config <pubkey>',
      'Config account to filter bonds accounts ' +
        `(no default, note: the Marinade config is: ${MARINADE_CONFIG_ADDRESS.toBase58()})`,
      parsePubkey
    )
    .action(
      async (
        address: Promise<PublicKey>,
        {
          config,
        }: {
          config?: Promise<PublicKey>
        }
      ) => {
        showBondAddress({
          address: await address,
          config: (await config) ?? MARINADE_CONFIG_ADDRESS,
        })
      }
    )
}
