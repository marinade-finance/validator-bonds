import { extendJestWithShellMatchers } from '@marinade.finance/jest-shell-matcher'
import {
  configureConfigInstruction,
  getConfig,
} from '@marinade.finance/validator-bonds-sdk'
import { initTest } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testValidator'
import { executeInitConfigInstruction } from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/testTransactions'
import { createTempFileKeypair } from '@marinade.finance/web3js-1x'

import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import type { ValidatorBondsProgram } from '@marinade.finance/validator-bonds-sdk'
import type { Keypair, PublicKey } from '@solana/web3.js'

describe('Pause and resume using CLI', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let pauseAuthorityPath: string
  let pauseAuthorityKeypair: Keypair
  let pauseAuthorityCleanup: () => Promise<void>
  let config: PublicKey

  beforeAll(() => {
    extendJestWithShellMatchers()
    ;({ provider, program } = initTest())
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

    await expect([
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
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /Succeeded to pause/,
    })
    configData = await getConfig(program, config)
    expect(configData.paused).toEqual(true)

    await expect([
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
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /Succeeded to resume/,
    })
    configData = await getConfig(program, config)
    expect(configData.paused).toEqual(false)
  })

  it('pause and resume in print-only mode', async () => {
    await expect([
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
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /Succeeded to pause/,
    })
    expect((await getConfig(program, config)).paused).toEqual(false)

    await expect([
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
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /Succeeded to resume/,
    })
    expect((await getConfig(program, config)).paused).toEqual(false)
  })
})
