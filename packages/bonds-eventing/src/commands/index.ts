import { installBidding } from './bidding'
import { installInstitutional } from './institutional'

import type { Command } from 'commander'

export function installCommands(program: Command) {
  installBidding(program)
  installInstitutional(program)
}
