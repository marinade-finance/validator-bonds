import assert from 'assert'

import { executeTxSimple, transaction } from '@marinade.finance/web3js-1x'
import { Keypair } from '@solana/web3.js'

import {
  EMERGENCY_PAUSE_EVENT,
  EMERGENCY_RESUME_EVENT,
  assertEvent,
  configureConfigInstruction,
  emergencyPauseInstruction,
  emergencyResumeInstruction,
  getConfig,
  parseCpiEvents,
} from '../../src'
import { executeInitConfigInstruction } from '../utils/testTransactions'
import { initTest } from '../utils/testValidator'

import type { Config, ValidatorBondsProgram } from '../../src'
import type { ProgramAccount } from '@coral-xyz/anchor'
import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'

describe('Validator Bonds pause and resume', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let config: ProgramAccount<Config>
  let pauseAuthority: Keypair

  beforeAll(() => {
    ;({ provider, program } = initTest())
  })

  beforeEach(async () => {
    const { configAccount, adminAuthority: adminAuth } =
      await executeInitConfigInstruction({
        program,
        provider,
        epochsToClaimSettlement: 1,
        withdrawLockupEpochs: 2,
      })
    config = {
      publicKey: configAccount,
      account: await getConfig(program, configAccount),
    }
    pauseAuthority = Keypair.generate()
    const { instruction: configureConfigIx } = await configureConfigInstruction(
      {
        program,
        configAccount: config.publicKey,
        newPauseAuthority: pauseAuthority.publicKey,
      }
    )
    await provider.sendIx([adminAuth], configureConfigIx)
  })

  it('pause and resume', async () => {
    let tx = await transaction(provider)
    const { instruction: pauseIx } = await emergencyPauseInstruction({
      program,
      configAccount: config.publicKey,
    })
    tx.add(pauseIx)
    const executionReturnPause = await executeTxSimple(
      provider.connection,
      tx,
      [provider.wallet, pauseAuthority]
    )

    let configData = await getConfig(program, config.publicKey)
    expect(configData.paused).toBeTruthy()

    tx = await transaction(provider)
    const { instruction: resumeIx } = await emergencyResumeInstruction({
      program,
      configAccount: config.publicKey,
    })
    tx.add(resumeIx)
    const executionReturnResume = await executeTxSimple(
      provider.connection,
      tx,
      [provider.wallet, pauseAuthority]
    )

    configData = await getConfig(program, config.publicKey)
    expect(configData.paused).toBeFalsy()

    const eventsPause = parseCpiEvents(program, executionReturnPause?.response)
    const ePause = assertEvent(eventsPause, EMERGENCY_PAUSE_EVENT)
    assert(ePause !== undefined)
    expect(ePause.config).toEqual(config.publicKey)
    expect(ePause.pauseAuthority).toEqual(pauseAuthority.publicKey)

    const eventsResume = parseCpiEvents(
      program,
      executionReturnResume?.response
    )
    const eResume = assertEvent(eventsResume, EMERGENCY_RESUME_EVENT)
    expect(eResume.config).toEqual(config.publicKey)
    expect(eResume.pauseAuthority).toEqual(pauseAuthority.publicKey)
  })
})
