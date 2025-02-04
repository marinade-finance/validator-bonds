import { parsePubkey } from '@marinade.finance/cli-common'
import {
  configureShowBondAddress,
  showBondAddress,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'
import { PublicKey } from '@solana/web3.js'
import { Command } from 'commander'

export function installShowBondAddress(command: Command) {
  const program = configureShowBondAddress(command)
  program
    .option(
      '--config <pubkey>',
      'Config account to filter bonds accounts ' +
        `(no default, note: the Marinade config is: ${MARINADE_CONFIG_ADDRESS.toBase58()})`,
      parsePubkey,
    )
    .action(
      async (
        address: Promise<PublicKey>,
        {
          config,
        }: {
          config?: Promise<PublicKey>
        },
      ) => {
        await showBondAddress({
          address: await address,
          config: (await config) ?? MARINADE_CONFIG_ADDRESS,
        })
      },
    )
}
