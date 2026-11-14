import { installBidding } from './bidding'
import { installInstitutional } from './institutional'
import { installSend } from './send'

import type { Command } from 'commander'

export function installCommands(program: Command) {
  installBidding(program)
  installInstitutional(program)
  installSend(program)
}
