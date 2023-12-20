import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  CONFIGURE_CONFIG_EVENT,
  Config,
  ConfigureConfigEvent,
  ValidatorBondsProgram,
  configureConfigInstruction,
  getConfig,
} from '../../src'
import { ProgramAccount } from '@coral-xyz/anchor'
import { AnchorExtendedProvider, initTest } from './testValidator'
import { transaction } from '@marinade.finance/anchor-common'
import { executeTxSimple } from '@marinade.finance/web3js-common'
import { executeInitConfigInstruction } from '../utils/testTransactions'

describe('Validator Bonds configure config', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let configInitialized: ProgramAccount<Config>
  let adminAuthority: Keypair

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
    configInitialized = {
      publicKey: configAccount,
      account: await getConfig(program, configAccount),
    }
    expect(configInitialized.account.adminAuthority).toEqual(
      adminAuth.publicKey
    )
    expect(configInitialized.account.epochsToClaimSettlement).toEqual(1)
    expect(configInitialized.account.withdrawLockupEpochs).toEqual(2)
    adminAuthority = adminAuth
  })

  it('configure config', async () => {
    const newAdminAuthority = Keypair.generate()
    const newOperatorAuthority = PublicKey.unique()

    const event = new Promise<ConfigureConfigEvent>(resolve => {
      const listener = program.addEventListener(
        CONFIGURE_CONFIG_EVENT,
        async event => {
          await program.removeEventListener(listener)
          resolve(event)
        }
      )
    })

    const tx = await transaction(provider)
    const { instruction } = await configureConfigInstruction({
      program,
      configAccount: configInitialized.publicKey,
      adminAuthority,
      newOperator: newOperatorAuthority,
      newAdmin: newAdminAuthority.publicKey,
      newEpochsToClaimSettlement: 100,
      newWithdrawLockupEpochs: 103,
      newMinimumStakeLamports: 1001,
    })
    tx.add(instruction)
    await executeTxSimple(provider.connection, tx, [
      provider.wallet,
      adminAuthority,
    ])

    const configData = await getConfig(program, configInitialized.publicKey)
    expect(configData.adminAuthority).toEqual(newAdminAuthority.publicKey)
    expect(configData.operatorAuthority).toEqual(newOperatorAuthority)
    expect(configData.epochsToClaimSettlement).toEqual(100)
    expect(configData.withdrawLockupEpochs).toEqual(103)
    expect(configData.minimumStakeLamports).toEqual(1001)

    await event.then(e => {
      expect(e.adminAuthority).toEqual({
        old: adminAuthority.publicKey,
        new: newAdminAuthority.publicKey,
      })
      expect(e.operatorAuthority).toEqual({
        old: configInitialized.account.operatorAuthority,
        new: newOperatorAuthority,
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
    })
  })
})
