import { Command } from 'commander'
import { installInitBond } from './initBond'
import { installConfigureBond } from './configureBond'
import { installFundBond } from './fundBond'
import { installFundBondWithSol } from './fundBondWithSol'
import { installMintBond } from './mintBond'

export function installManage(program: Command) {
  installInitBond(program)
  installConfigureBond(program)
  installFundBond(program)
  installFundBondWithSol(program)
  installMintBond(program)
}
