import {
  configureShowBondAddress,
  showBondAddress,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_INSTITUTIONAL_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'

import type { PublicKey } from '@solana/web3.js'
import type { Command } from 'commander'

export function installShowBondAddress(command: Command) {
  const program = configureShowBondAddress(command)
  program.action(async (address: Promise<PublicKey>) => {
    showBondAddress({
      address: await address,
      config: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
    })
  })
}
