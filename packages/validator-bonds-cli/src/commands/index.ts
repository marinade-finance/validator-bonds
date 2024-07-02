import { Command } from 'commander'
import { installManage } from './manage'
import {
  installShowConfig,
  installShowEvent,
  installShowBond,
  installShowSettlement,
} from './show'
import { installShowBondAddress } from './address'

export * from './utils'

export function installCommands(program: Command) {
  installManage(program)
  installShowConfig(program)
  installShowEvent(program)
  installShowBond(program)
  installShowSettlement(program)
  installShowBondAddress(program)
}
