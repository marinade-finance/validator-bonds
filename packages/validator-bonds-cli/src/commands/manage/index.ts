import { Command } from 'commander'
import { installInitConfig } from './initConfig'
import { installConfigureConfig } from './configureConfig'
import { installInitBond } from './initBond'
import { installConfigureBond } from './configureBond'

export function installManage(program: Command) {
  installInitConfig(program)
  installConfigureConfig(program)
  installInitBond(program)
  installConfigureBond(program)
}
