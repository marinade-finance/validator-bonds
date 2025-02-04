import { FormatType, ReformatAction } from '@marinade.finance/cli-common'
import {
  configureShowBond,
  getCliContext,
  reformatBond,
  showBond,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_INSTITUTIONAL_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'
import { PublicKey } from '@solana/web3.js'
import { Command } from 'commander'

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
      },
    ) => {
      await showBond({
        address: await address,
        config: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
        bondAuthority: await bondAuthority,
        withFunding,
        format,
        reformatBondFunction: reformatBondInstitutional,
      })
    },
  )
}

export function reformatBondInstitutional(
  key: string,
  value: unknown,
): ReformatAction {
  if (!getCliContext().logger.isLevelEnabled('debug')) {
    if (
      typeof key === 'string' &&
      ((key as string).startsWith('cpmpe') ||
        (key as string).startsWith('maxStakeWanted') ||
        (key as string).startsWith('withdrawRequest'))
    ) {
      return { type: 'Remove' }
    }
  }

  return reformatBond(key, value)
}
