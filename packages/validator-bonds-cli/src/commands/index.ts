import {
  installShowConfig,
  installShowEvent,
  installShowSettlement,
} from '@marinade.finance/validator-bonds-cli-core'

import { installShowBondAddress } from './address'
import { installManage } from './manage'
import { installShowBond } from './show'
import { installShowNotifications } from './showNotifications'

import type { Command } from 'commander'

export function installCommands(program: Command) {
  installManage(program)
  installShowConfig(program)
  installShowEvent(program)
  installShowBond(program)
  installShowSettlement(program)
  installShowBondAddress(program)
  installShowNotifications(program)
}
