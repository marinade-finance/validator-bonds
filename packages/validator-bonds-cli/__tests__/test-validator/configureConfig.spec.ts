import { createTempFileKeypair } from '@marinade.finance/web3js-common'
import { shellMatchers } from '@marinade.finance/jest-utils'
import { Keypair, PublicKey } from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  getConfig,
} from '@marinade.finance/validator-bonds-sdk'
import { executeInitConfigInstruction } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testTransactions'
import {
  AnchorExtendedProvider,
  initTest,
} from '@marinade.finance/validator-bonds-sdk/__tests__/test-validator/testValidator'

describe('Configure config account using CLI', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let adminPath: string
  let adminKeypair: Keypair
  let adminCleanup: () => Promise<void>
  let configAccount: PublicKey
  let operatorAuthority: Keypair

  beforeAll(async () => {
    shellMatchers()
    ;({ provider, program } = await initTest())
  })

  beforeEach(async () => {
    ;({
      path: adminPath,
      keypair: adminKeypair,
      cleanup: adminCleanup,
    } = await createTempFileKeypair())
    ;({ configAccount, operatorAuthority } = await executeInitConfigInstruction(
      {
        program,
        provider,
        adminAuthority: adminKeypair,
        epochsToClaimSettlement: 1,
        withdrawLockupEpochs: 2,
      }
    ))
    expect(
      provider.connection.getAccountInfo(configAccount)
    ).resolves.not.toBeNull()
  })

  afterEach(async () => {
    await adminCleanup()
  })

  it('configure config account', async () => {
    const newAdmin = Keypair.generate()

    await (
      expect([
        'pnpm',
        [
          'cli',
          '-u',
          provider.connection.rpcEndpoint,
          '--program-id',
          program.programId.toBase58(),
          'configure-config',
          configAccount.toBase58(),
          '--confirmation-finality',
          'confirmed',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 1,
      // stderr: '',
      stdout: /No new config values provided/,
    })

    await (
      expect([
        'pnpm',
        [
          'cli',
          '-u',
          provider.connection.rpcEndpoint,
          '--program-id',
          program.programId.toBase58(),
          'configure-config',
          configAccount.toBase58(),
          '--admin-authority',
          adminPath,
          '--operator',
          PublicKey.default.toBase58(),
          '--admin',
          newAdmin.publicKey.toBase58(),
          '--pause-authority',
          PublicKey.default.toBase58(),
          '--epochs-to-claim-settlement',
          111,
          '--withdraw-lockup-epochs',
          112,
          '--minimum-stake-lamports',
          134,
          '--confirmation-finality',
          'confirmed',
          '-v',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /successfully configured/,
    })

    const configData = await getConfig(program, configAccount)
    expect(configData.adminAuthority).toEqual(newAdmin.publicKey)
    expect(configData.operatorAuthority).toEqual(PublicKey.default)
    expect(configData.pauseAuthority).toEqual(PublicKey.default)
    expect(configData.epochsToClaimSettlement).toEqual(111)
    expect(configData.withdrawLockupEpochs).toEqual(112)
    expect(configData.minimumStakeLamports).toEqual(134)
  })

  it('configure config in print-only mode', async () => {
    await (
      expect([
        'pnpm',
        [
          'cli',
          '-u',
          provider.connection.rpcEndpoint,
          'configure-config',
          configAccount.toBase58(),
          '--admin-authority',
          adminKeypair.publicKey.toBase58(),
          '--operator',
          PublicKey.default.toBase58(),
          '--print-only',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /successfully configured/,
    })
    expect((await getConfig(program, configAccount)).operatorAuthority).toEqual(
      operatorAuthority.publicKey
    )
  })
})
