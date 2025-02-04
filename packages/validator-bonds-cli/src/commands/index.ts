import { Command } from 'commander'
import { installManage } from './manage'
import { installShowBondAddress } from './address'
import {
  installShowConfig,
  installShowEvent,
  installShowSettlement,
} from '@marinade.finance/validator-bonds-cli-core'
import { installShowBond } from './show'

export function installCommands(program: Command) {
  installManage(program)
  installShowConfig(program)
  installShowEvent(program)
  installShowBond(program)
  installShowSettlement(program)
  installShowBondAddress(program)
}
