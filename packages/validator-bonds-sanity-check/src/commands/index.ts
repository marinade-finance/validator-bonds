import { installCheck } from './check'
import { installCheckSettlement } from './checkSettlement'

import type { Command } from 'commander'

export function installCommands(program: Command) {
  installCheck(program)
  installCheckSettlement(program)
}
