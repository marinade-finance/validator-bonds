import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  CONFIGURE_CONFIG_EVENT,
  Config,
  ValidatorBondsProgram,
  assertEvent,
  configureConfigInstruction,
  getConfig,
  parseCpiEvents,
} from '../../src'
import { ProgramAccount } from '@coral-xyz/anchor'
import { initTest } from './testValidator'
import { executeTxSimple, transaction } from '@marinade.finance/web3js-common'
import { executeInitConfigInstruction } from '../utils/testTransactions'
import { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import assert from 'assert'

describe('Validator Bonds configure config', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let configInitialized: ProgramAccount<Config>
  let adminAuthority: Keypair

  beforeAll(async () => {
    ;({ provider, program } = await initTest())
  })

  beforeEach(async () => {
    const { configAccount, adminAuthority: adminAuth } =
      await executeInitConfigInstruction({
        program,
        provider,
        epochsToClaimSettlement: 1,
        withdrawLockupEpochs: 2,
      })
    configInitialized = {
      publicKey: configAccount,
      account: await getConfig(program, configAccount),
    }
    expect(configInitialized.account.adminAuthority).toEqual(
      adminAuth.publicKey,
    )
    expect(configInitialized.account.epochsToClaimSettlement).toEqual(1)
    expect(configInitialized.account.withdrawLockupEpochs).toEqual(2)
    adminAuthority = adminAuth
  })

  it('configure config', async () => {
    const newAdminAuthority = Keypair.generate()
    const newOperatorAuthority = PublicKey.unique()
    const newPauseAuthority = PublicKey.unique()

    const tx = await transaction(provider)
    const { instruction } = await configureConfigInstruction({
      program,
      configAccount: configInitialized.publicKey,
      adminAuthority,
      newOperator: newOperatorAuthority,
      newAdmin: newAdminAuthority.publicKey,
      newPauseAuthority: newPauseAuthority,
      newEpochsToClaimSettlement: 100,
      newWithdrawLockupEpochs: 103,
      newMinimumStakeLamports: 1001,
      newMinBondMaxStakeWanted: 1002,
    })
    tx.add(instruction)
    const executionReturn = await executeTxSimple(provider.connection, tx, [
      provider.wallet,
      adminAuthority,
    ])

    const configData = await getConfig(program, configInitialized.publicKey)
    expect(configData.adminAuthority).toEqual(newAdminAuthority.publicKey)
    expect(configData.operatorAuthority).toEqual(newOperatorAuthority)
    expect(configData.pauseAuthority).toEqual(newPauseAuthority)
    expect(configData.paused).toBeFalsy()
    expect(configData.epochsToClaimSettlement).toEqual(100)
    expect(configData.withdrawLockupEpochs).toEqual(103)
    expect(configData.minimumStakeLamports).toEqual(1001)
    expect(configData.minBondMaxStakeWanted).toEqual(1002)

    const events = parseCpiEvents(program, executionReturn?.response)
    const e = assertEvent(events, CONFIGURE_CONFIG_EVENT)
    // Ensure the event was emitted
    assert(e !== undefined)
    expect(e.adminAuthority).toEqual({
      old: adminAuthority.publicKey,
      new: newAdminAuthority.publicKey,
    })
    expect(e.operatorAuthority).toEqual({
      old: configInitialized.account.operatorAuthority,
      new: newOperatorAuthority,
    })
    expect(e.pauseAuthority).toEqual({
      old: configInitialized.account.pauseAuthority,
      new: newPauseAuthority,
    })
    expect(e.epochsToClaimSettlement).toEqual({
      old: configInitialized.account.epochsToClaimSettlement,
      new: 100,
    })
    expect(e.withdrawLockupEpochs).toEqual({
      old: configInitialized.account.withdrawLockupEpochs,
      new: 103,
    })
    expect(e.minimumStakeLamports).toEqual({
      old: LAMPORTS_PER_SOL,
      new: 1001,
    })
    expect(e.minBondMaxStakeWanted).toEqual({
      old: 0,
      new: 1002,
    })
  })
})
