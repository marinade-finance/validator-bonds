import { Command } from 'commander'
import { installInitConfig } from './initConfig'
import { installConfigureConfig } from './configureConfig'
import { installInitBond } from './initBond'
import { installConfigureBond } from './configureBond'
import { installMintBond } from './mintBond'
import { installStakeMerge } from './mergeStake'
import { installFundBond } from './fundBond'
import { installInitWithdrawRequest } from './initWithdrawRequest'
import { installCancelWithdrawRequest } from './cancelWithdrawRequest'
import { installClaimWithdrawRequest } from './claimWithdrawRequest'
import {
  installEmergencyPause,
  installEmergencyResume,
} from './emergencyPauseAndResume'

export function installManage(program: Command) {
  installInitConfig(program)
  installConfigureConfig(program)
  installMintBond(program)
  installInitBond(program)
  installConfigureBond(program)
  installStakeMerge(program)
  installFundBond(program)
  installInitWithdrawRequest(program)
  installCancelWithdrawRequest(program)
  installClaimWithdrawRequest(program)
  installEmergencyPause(program)
  installEmergencyResume(program)
}
