import {
  installShowNotifications,
  installSubscribe,
  installSubscriptions,
  installUnsubscribe,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'

import { installCancelWithdrawRequest } from './cancelWithdrawRequest'
import { installClaimWithdrawRequest } from './claimWithdrawRequest'
import { installCloseSettlement } from './closeSettlement'
import { installConfigureBond } from './configureBond'
import { installConfigureConfig } from './configureConfig'
import {
  installEmergencyPause,
  installEmergencyResume,
} from './emergencyPauseAndResume'
import { installFundBond } from './fundBond'
import { installFundBondWithSol } from './fundBondWithSol'
import { installInitBond } from './initBond'
import { installInitConfig } from './initConfig'
import { installInitWithdrawRequest } from './initWithdrawRequest'
import { installStakeMerge } from './mergeStake'
import { installMintBond } from './mintBond'
import { installResetStake } from './resetStake'

import type { Command } from 'commander'

export function installManage(program: Command) {
  installInitConfig(program)
  installConfigureConfig(program)
  installMintBond(program)
  installInitBond(program)
  installConfigureBond(program)
  installStakeMerge(program)
  installFundBond(program)
  installFundBondWithSol(program)
  installInitWithdrawRequest(program)
  installCancelWithdrawRequest(program)
  installClaimWithdrawRequest(program)
  installEmergencyPause(program)
  installEmergencyResume(program)
  installCloseSettlement(program)
  installResetStake(program)
  installSubscribe(program, MARINADE_CONFIG_ADDRESS)
  installUnsubscribe(program, MARINADE_CONFIG_ADDRESS)
  installSubscriptions(program, MARINADE_CONFIG_ADDRESS)
  installShowNotifications(program, MARINADE_CONFIG_ADDRESS)
}
