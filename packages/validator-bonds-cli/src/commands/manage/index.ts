import { Command } from 'commander'
import { installInitConfig } from './initConfig'
import { installConfigureConfig } from './configureConfig'
import { installInitBond } from './initBond'
import { installConfigureBond } from './configureBond'
import { installMerge } from './merge'
import { installFundBond } from './fundBond'

export function installManage(program: Command) {
  installInitConfig(program)
  installConfigureConfig(program)
  installInitBond(program)
  installConfigureBond(program)
  installMerge(program)
  installFundBond(program)
}
