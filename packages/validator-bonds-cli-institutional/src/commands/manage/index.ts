import { Command } from 'commander'
import { installInitBond } from './initBond'
import { installConfigureBond } from './configureBond'
import { installFundBond } from './fundBond'
import { installFundBondWithSol } from './fundBondWithSol'
import { installMintBond } from './mintBond'
import { installInitWithdrawRequest } from './initWithdrawRequest'
import { installClaimWithdrawRequest } from './claimWithdrawRequest'
import { installCancelWithdrawRequest } from './cancelWithdrawRequest'

export function installManage(program: Command) {
  installInitBond(program)
  installConfigureBond(program)
  installFundBond(program)
  installFundBondWithSol(program)
  installMintBond(program)
  installInitWithdrawRequest(program)
  installClaimWithdrawRequest(program)
  installCancelWithdrawRequest(program)
}
