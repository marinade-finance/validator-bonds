import {
  configureShowBond,
  reformatBond,
  showBond,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_INSTITUTIONAL_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'

import type { FormatType } from '@marinade.finance/cli-common'
import type { ReformatAction } from '@marinade.finance/web3js-1x'
import type { PublicKey } from '@solana/web3.js'
import type { Command } from 'commander'

export function installShowBond(program: Command) {
  program = configureShowBond(program)
  program.action(
    async (
      address: Promise<PublicKey | undefined>,
      {
        bondAuthority,
        withFunding,
        format,
      }: {
        bondAuthority?: Promise<PublicKey>
        withFunding: boolean
        format: FormatType
      }
    ) => {
      await showBond({
        address: await address,
        config: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
        bondAuthority: await bondAuthority,
        withFunding,
        format,
        reformatBondFunction: reformatBondInstitutional,
      })
    }
  )
}

export function reformatBondInstitutional(
  key: string,
  value: unknown
): ReformatAction {
  if (
    typeof key === 'string' &&
    (key.startsWith('cpmpe') || key.startsWith('maxStakeWanted'))
  ) {
    return { type: 'Remove' }
  }

  return reformatBond(key, value)
}
