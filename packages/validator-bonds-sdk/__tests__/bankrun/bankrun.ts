import {
  ValidatorBondsProgram,
  checkAndGetBondAddress,
  getProgram,
} from '../../src'
import { Keypair, PublicKey } from '@solana/web3.js'
import {
  BankrunExtendedProvider,
  currentEpoch,
  testInit,
  warpToNextEpoch,
} from '@marinade.finance/bankrun-utils'
import {
  StakeStates,
  delegatedStakeAccount,
  getAndCheckStakeAccount,
} from '../utils/staking'
import {
  executeFundBondInstruction,
  executeInitBondInstruction,
} from '../utils/testTransactions'
import 'reflect-metadata'
import { BN } from 'bn.js'
import { U64_MAX } from '@marinade.finance/web3js-common'

export async function initBankrunTest(programId?: PublicKey): Promise<{
  program: ValidatorBondsProgram
  provider: BankrunExtendedProvider
}> {
  const provider = await testInit({ accountDirs: ['./fixtures/accounts/'] })
  return {
    program: getProgram({ connection: provider, programId }),
    provider,
  }
}

export async function currentSlot(
  provider: BankrunExtendedProvider
): Promise<number> {
  return Number((await provider.context.banksClient.getClock()).slot)
}

export async function warpOffsetSlot(
  provider: BankrunExtendedProvider,
  plusSlots: number
) {
  const nextSlot = (await currentSlot(provider)) + plusSlots
  provider.context.warpToSlot(BigInt(nextSlot))
}

// this cannot be in generic testTransactions.ts because of warping requires BankrunProvider
export async function delegateAndFund({
  program,
  provider,
  lamports,
  voteAccount,
  bondAccount,
  configAccount,
}: {
  program: ValidatorBondsProgram
  provider: BankrunExtendedProvider
  lamports: number
  voteAccount?: PublicKey
  bondAccount?: PublicKey
  configAccount?: PublicKey
}): Promise<{
  stakeAccount: PublicKey
  bondAccount: PublicKey
  voteAccount: PublicKey
  validatorIdentity: Keypair | undefined
}> {
  const {
    stakeAccount,
    withdrawer,
    voteAccount: voteAccountDelegated,
    validatorIdentity,
  } = await delegatedStakeAccount({
    provider,
    lamports,
    voteAccountToDelegate: voteAccount,
  })
  if (bondAccount && configAccount) {
    const bondToCheck = checkAndGetBondAddress(
      undefined,
      configAccount,
      voteAccountDelegated,
      program.programId
    )
    expect(bondAccount).toEqual(bondToCheck)
  }
  if (
    bondAccount === undefined ||
    (await provider.connection.getAccountInfo(bondAccount)) === null
  ) {
    if (configAccount === undefined) {
      throw new Error('delegateAndFund: configAccount is required')
    }
    ;({ bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      voteAccount: voteAccountDelegated,
      validatorIdentity,
      configAccount,
    }))
  }

  await warpToNextEpoch(provider) // activating stake account
  await executeFundBondInstruction({
    program,
    provider,
    bondAccount: bondAccount,
    stakeAccount,
    stakeAccountAuthority: withdrawer,
  })
  return {
    stakeAccount,
    bondAccount,
    voteAccount: voteAccountDelegated,
    validatorIdentity,
  }
}

export enum StakeActivationState {
  Activating,
  Deactivating,
  Activated,
  Deactivated,
  Unknown,
  NonDelegated,
}

export async function stakeActivation(
  provider: BankrunExtendedProvider,
  stakeAccount: PublicKey
): Promise<StakeActivationState> {
  const [stakeState] = await getAndCheckStakeAccount(
    provider,
    stakeAccount,
    StakeStates.Delegated
  )
  if (stakeState.Stake !== undefined) {
    const activationEpoch = stakeState.Stake.stake.delegation.activationEpoch
    const deactivationEpoch =
      stakeState.Stake.stake.delegation.deactivationEpoch
    const curEpoch = new BN(await currentEpoch(provider))
    console.log(
      'activationEpoch',
      activationEpoch.toString(),
      'deactivationEpoch',
      deactivationEpoch.toString(),
      'currentEpoch',
      curEpoch.toString()
    )

    if (!deactivationEpoch.eq(U64_MAX) && deactivationEpoch.gte(curEpoch)) {
      return StakeActivationState.Deactivating
    } else if (!activationEpoch.eq(U64_MAX) && activationEpoch.gte(curEpoch)) {
      return StakeActivationState.Activating
    } else if (
      !deactivationEpoch.eq(U64_MAX) &&
      deactivationEpoch.lt(curEpoch)
    ) {
      return StakeActivationState.Deactivated
    } else if (!activationEpoch.eq(U64_MAX) && activationEpoch.lt(curEpoch)) {
      return StakeActivationState.Activated
    } else {
      return StakeActivationState.Unknown
    }
  }
  // Uninitialized, RewardsPool, anything else...
  return StakeActivationState.NonDelegated
}
