import { installCheck } from './check'

import type { Command } from 'commander'

export function installCommands(program: Command) {
  installCheck(program)
}
