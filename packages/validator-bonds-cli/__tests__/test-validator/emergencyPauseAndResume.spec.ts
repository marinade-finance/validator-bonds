import { createTempFileKeypair } from '@marinade.finance/web3js-common'
import { shellMatchers } from '@marinade.finance/jest-utils'
import { Keypair, PublicKey } from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  configureConfigInstruction,
  getConfig,
} from '@marinade.finance/validator-bonds-sdk'
import { executeInitConfigInstruction } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testTransactions'
import { initTest } from '@marinade.finance/validator-bonds-sdk/__tests__/test-validator/testValidator'
import { AnchorExtendedProvider } from '@marinade.finance/anchor-common'

describe('Pause and resume using CLI', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let pauseAuthorityPath: string
  let pauseAuthorityKeypair: Keypair
  let pauseAuthorityCleanup: () => Promise<void>
  let config: PublicKey

  beforeAll(async () => {
    shellMatchers()
    ;({ provider, program } = await initTest())
  })

  beforeEach(async () => {
    ;({
      path: pauseAuthorityPath,
      keypair: pauseAuthorityKeypair,
      cleanup: pauseAuthorityCleanup,
    } = await createTempFileKeypair())
    const { configAccount, adminAuthority } =
      await executeInitConfigInstruction({
        program,
        provider,
        epochsToClaimSettlement: 1,
        withdrawLockupEpochs: 2,
      })
    config = configAccount
    const { instruction: configIx } = await configureConfigInstruction({
      program,
      configAccount,
      newPauseAuthority: pauseAuthorityKeypair.publicKey,
    })
    await provider.sendIx([adminAuthority], configIx)
  })

  afterEach(async () => {
    await pauseAuthorityCleanup()
  })

  it('pause and resume', async () => {
    let configData = await getConfig(program, config)
    expect(configData.paused).toEqual(false)

    await (
      expect([
        'pnpm',
        [
          'cli',
          '-u',
          provider.connection.rpcEndpoint,
          '--program-id',
          program.programId.toBase58(),
          'pause',
          config.toBase58(),
          '--authority',
          pauseAuthorityPath,
          '--confirmation-finality',
          'confirmed',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /Succeeded to pause/,
    })
    configData = await getConfig(program, config)
    expect(configData.paused).toEqual(true)

    await (
      expect([
        'pnpm',
        [
          'cli',
          '-u',
          provider.connection.rpcEndpoint,
          '--program-id',
          program.programId.toBase58(),
          'resume',
          config.toBase58(),
          '--authority',
          pauseAuthorityPath,
          '--confirmation-finality',
          'confirmed',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /Succeeded to resume/,
    })
    configData = await getConfig(program, config)
    expect(configData.paused).toEqual(false)
  })

  it('pause and resume in print-only mode', async () => {
    await (
      expect([
        'pnpm',
        [
          'cli',
          '--program-id',
          program.programId.toBase58(),
          'pause',
          config.toBase58(),
          '--authority',
          pauseAuthorityPath,
          '--print-only',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /Succeeded to pause/,
    })
    expect((await getConfig(program, config)).paused).toEqual(false)

    await (
      expect([
        'pnpm',
        [
          'cli',
          '--program-id',
          program.programId.toBase58(),
          'resume',
          config.toBase58(),
          '--authority',
          pauseAuthorityPath,
          '--print-only',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /Succeeded to resume/,
    })
    expect((await getConfig(program, config)).paused).toEqual(false)
  })
})
