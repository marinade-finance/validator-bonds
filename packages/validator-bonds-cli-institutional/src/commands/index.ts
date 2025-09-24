import { installShowBondAddress } from './address'
import { installManage } from './manage'
import { installShowBond } from './show'

import type { Command } from 'commander'

export function installCommands(program: Command) {
  installShowBondAddress(program)
  installShowBond(program)
  installManage(program)
}
