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
import { createVoteAccount } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/staking'

describe('Init bond account using CLI', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let adminPath: string
  let adminKeypair: Keypair
  let adminCleanup: () => Promise<void>
  let voteWithdrawerPath: string
  let voteWithdrawerKeypair: Keypair
  let voteWithdrawerCleanup: () => Promise<void>
  let configAccount: PublicKey
  let voteAccount: PublicKey

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
    ;({
      path: voteWithdrawerPath,
      keypair: voteWithdrawerKeypair,
      cleanup: voteWithdrawerCleanup,
    } = await createTempFileKeypair())
    ;({ configAccount } = await executeInitConfigInstruction(
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
    const { voteAccount } =
      await createVoteAccount(provider)
  })

  afterEach(async () => {
    await adminCleanup()
  })

  it.only('init bond account', async () => {
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
          'init-bond',
          '--config',
          configAccount.toBase58(),

        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /successfully created/,
    })

    const configData = await getConfig(program, configAccount)
    expect(configData.adminAuthority).toEqual(newAdmin.publicKey)
    expect(configData.operatorAuthority).toEqual(PublicKey.default)
    expect(configData.epochsToClaimSettlement).toEqual(111)
    expect(configData.withdrawLockupEpochs).toEqual(112)
    expect(configData.minimumStakeLamports).toEqual(134)
  })

  it('init bond in print-only mode', async () => {
    console.log('working with account: ', configAccount.toBase58())
    // this is a "mock test" that just checks that print only command works
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
          adminPath,
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
