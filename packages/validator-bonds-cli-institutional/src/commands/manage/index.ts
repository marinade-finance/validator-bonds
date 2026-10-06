import {
  installShowNotifications,
  installSubscribe,
  installSubscriptions,
  installUnsubscribe,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_INSTITUTIONAL_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'

import { installCancelWithdrawRequest } from './cancelWithdrawRequest'
import { installClaimWithdrawRequest } from './claimWithdrawRequest'
import { installConfigureBond } from './configureBond'
import { installFundBond } from './fundBond'
import { installFundBondWithSol } from './fundBondWithSol'
import { installInitBond } from './initBond'
import { installInitWithdrawRequest } from './initWithdrawRequest'
import { installMintBond } from './mintBond'

import type { Command } from 'commander'

export function installManage(program: Command) {
  installInitBond(program)
  installConfigureBond(program)
  installFundBond(program)
  installFundBondWithSol(program)
  installMintBond(program)
  installInitWithdrawRequest(program)
  installClaimWithdrawRequest(program)
  installCancelWithdrawRequest(program)
  installSubscribe(program, MARINADE_INSTITUTIONAL_CONFIG_ADDRESS)
  installUnsubscribe(program, MARINADE_INSTITUTIONAL_CONFIG_ADDRESS)
  installSubscriptions(program, MARINADE_INSTITUTIONAL_CONFIG_ADDRESS)
  installShowNotifications(program, MARINADE_INSTITUTIONAL_CONFIG_ADDRESS)
}
