import { Keypair } from '@solana/web3.js'
import {
  Config,
  EMERGENCY_PAUSE_EVENT,
  EMERGENCY_RESUME_EVENT,
  EmergencyPauseEvent,
  EmergencyResumeEvent,
  ValidatorBondsProgram,
  configureConfigInstruction,
  emergencyPauseInstruction,
  emergencyResumeInstruction,
  getConfig,
} from '../../src'
import { ProgramAccount } from '@coral-xyz/anchor'
import { initTest } from './testValidator'
import { executeTxSimple, transaction } from '@marinade.finance/web3js-common'
import { executeInitConfigInstruction } from '../utils/testTransactions'
import { AnchorExtendedProvider } from '@marinade.finance/anchor-common'

describe('Validator Bonds pause and resume', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let config: ProgramAccount<Config>
  let pauseAuthority: Keypair

  beforeAll(async () => {
    ;({ provider, program } = await initTest())
  })

  afterAll(async () => {
    // workaround: "Jest has detected the following 1 open handle", see `initConfig.spec.ts`
    await new Promise(resolve => setTimeout(resolve, 500))
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
    const eventPause = new Promise<EmergencyPauseEvent>(resolve => {
      const listener = program.addEventListener(
        EMERGENCY_PAUSE_EVENT,
        async eventPause => {
          await program.removeEventListener(listener)
          resolve(eventPause)
        }
      )
    })
    const eventResume = new Promise<EmergencyResumeEvent>(resolve => {
      const listener = program.addEventListener(
        EMERGENCY_RESUME_EVENT,
        async eventResume => {
          await program.removeEventListener(listener)
          resolve(eventResume)
        }
      )
    })

    let tx = await transaction(provider)
    const { instruction: pauseIx } = await emergencyPauseInstruction({
      program,
      configAccount: config.publicKey,
    })
    tx.add(pauseIx)
    await executeTxSimple(provider.connection, tx, [
      provider.wallet,
      pauseAuthority,
    ])

    let configData = await getConfig(program, config.publicKey)
    expect(configData.paused).toBeTruthy()

    tx = await transaction(provider)
    const { instruction: resumeIx } = await emergencyResumeInstruction({
      program,
      configAccount: config.publicKey,
    })
    tx.add(resumeIx)
    await executeTxSimple(provider.connection, tx, [
      provider.wallet,
      pauseAuthority,
    ])

    configData = await getConfig(program, config.publicKey)
    expect(configData.paused).toBeFalsy()

    await eventPause.then(e => {
      expect(e.config).toEqual(config.publicKey)
      expect(e.pauseAuthority).toEqual(pauseAuthority.publicKey)
    })
    await eventResume.then(e => {
      expect(e.config).toEqual(config.publicKey)
      expect(e.pauseAuthority).toEqual(pauseAuthority.publicKey)
    })
  })
})
