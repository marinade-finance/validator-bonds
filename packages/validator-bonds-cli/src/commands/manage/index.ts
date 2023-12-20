import { Command } from 'commander'
import { installInitConfig } from './initConfig'
import { installConfigureConfig } from './configureConfig'

export function installManage(program: Command) {
  installInitConfig(program)
  installConfigureConfig(program)
}
