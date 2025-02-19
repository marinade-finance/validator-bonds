import {
  FormatType,
  ReformatAction,
  parsePubkey,
} from '@marinade.finance/cli-common'
import {
  configureShowBond,
  reformatBond,
  showBond,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'
import { PublicKey } from '@solana/web3.js'
import { Command } from 'commander'

export function installShowBond(program: Command) {
  program = configureShowBond(program)
  program
    .option(
      '--config <pubkey>',
      'Config account to filter bonds accounts ' +
        `(no default, note: the Marinade config is: ${MARINADE_CONFIG_ADDRESS.toBase58()})`,
      parsePubkey,
    )
    .action(
      async (
        address: Promise<PublicKey | undefined>,
        {
          config,
          bondAuthority,
          withFunding,
          format,
        }: {
          config?: Promise<PublicKey>
          bondAuthority?: Promise<PublicKey>
          withFunding: boolean
          format: FormatType
        },
      ) => {
        await showBond({
          address: await address,
          config: await config,
          bondAuthority: await bondAuthority,
          withFunding,
          format,
          reformatBondFunction: reformatBondBidding,
        })
      },
    )
}

export function reformatBondBidding(
  key: string,
  value: unknown,
): ReformatAction {
  if (
    typeof key === 'string' &&
    // Max Stake Wanted is no longer used in ds-sam bidding auctions (MIP-10).
    // The on-chain data still exists but is not useful to users, so the CLI no longer displays it.
    (key as string).startsWith('maxStakeWanted')
  ) {
    return { type: 'Remove' }
  }

  return reformatBond(key, value)
}
