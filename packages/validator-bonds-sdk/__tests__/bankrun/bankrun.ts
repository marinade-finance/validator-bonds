import {
  ValidatorBondsProgram,
  checkAndGetBondAddress,
  getProgram,
} from '../../src'
import { Keypair, PublicKey } from '@solana/web3.js'
import {
  BankrunExtendedProvider,
  testInit,
  warpToNextEpoch,
} from '@marinade.finance/bankrun-utils'
import { delegatedStakeAccount } from '../utils/staking'
import {
  executeFundBondInstruction,
  executeInitBondInstruction,
} from '../utils/testTransactions'
import 'reflect-metadata'

export async function initBankrunTest(programId?: PublicKey): Promise<{
  program: ValidatorBondsProgram
  provider: BankrunExtendedProvider
}> {
  const provider = await testInit(['./fixtures/accounts/'])
  return {
    program: getProgram({ connection: provider, programId }),
    provider,
  }
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
