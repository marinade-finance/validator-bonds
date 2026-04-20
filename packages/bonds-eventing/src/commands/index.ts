import { installBidding } from './bidding'

import type { Command } from 'commander'

export function installCommands(program: Command) {
  installBidding(program)
}
