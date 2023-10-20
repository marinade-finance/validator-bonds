import { Command } from 'commander'
import { installManage } from './manage'
import { installShowConfig, installShowEvent } from './show'

export function installCommands(program: Command) {
  installManage(program)
  installShowConfig(program)
  installShowEvent(program)
}
