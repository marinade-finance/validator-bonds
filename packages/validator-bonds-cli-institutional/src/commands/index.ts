import { Command } from 'commander'
import { installShowBondAddress } from './address'
import { installShowBond } from './show'
import { installManage } from './manage'

export function installCommands(program: Command) {
  installShowBondAddress(program)
  installShowBond(program)
  installManage(program)
}
