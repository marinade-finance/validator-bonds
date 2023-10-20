import { Command } from 'commander'
import { installInitConfig } from './initConfig'

export function installManage(program: Command) {
  installInitConfig(program)
}
