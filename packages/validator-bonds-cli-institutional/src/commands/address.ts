import {
  configureShowBondAddress,
  showBondAddress,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_INSTITUTIONAL_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'
import { PublicKey } from '@solana/web3.js'
import { Command } from 'commander'

export function installShowBondAddress(command: Command) {
  const program = configureShowBondAddress(command)
  program.action(async (address: Promise<PublicKey>) => {
    await showBondAddress({
      address: await address,
      config: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
    })
  })
}
