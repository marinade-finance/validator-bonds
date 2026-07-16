import { parsePubkey } from '@marinade.finance/web3js-1x'

import type { PublicKey } from '@solana/web3.js'
import type { Command } from 'commander'

export function withConfigOption(
  command: Command,
  defaultConfigAddress: PublicKey,
): Command {
  return command.option(
    '--config <pubkey>',
    'The config account that the bond account is created under ' +
      '(optional; to derive bond address from vote account address) ' +
      `(default: ${defaultConfigAddress.toBase58()})`,
    parsePubkey,
  )
}
