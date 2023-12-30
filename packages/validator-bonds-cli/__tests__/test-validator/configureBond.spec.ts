import { createTempFileKeypair } from '@marinade.finance/web3js-common'
import { shellMatchers } from '@marinade.finance/jest-utils'
import { Keypair, PublicKey } from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  bondAddress,
  getBond,
} from '@marinade.finance/validator-bonds-sdk'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testTransactions'
import {
  AnchorExtendedProvider,
  initTest,
} from '@marinade.finance/validator-bonds-sdk/__tests__/test-validator/testValidator'
import { createVoteAccount } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/staking'

describe('Configure bond account using CLI', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let voteWithdrawerPath: string
  let voteWithdrawerKeypair: Keypair
  let voteWithdrawerCleanup: () => Promise<void>
  let bondAuthorityPath: string
  let bondAuthorityKeypair: Keypair
  let bondAuthorityCleanup: () => Promise<void>
  let configAccount: PublicKey
  let bondAccount: PublicKey
  let voteAccount: PublicKey

  beforeAll(async () => {
    shellMatchers()
    ;({ provider, program } = await initTest())
  })

  beforeEach(async () => {
    ;({
      path: voteWithdrawerPath,
      keypair: voteWithdrawerKeypair,
      cleanup: voteWithdrawerCleanup,
    } = await createTempFileKeypair())
    ;({
      path: bondAuthorityPath,
      keypair: bondAuthorityKeypair,
      cleanup: bondAuthorityCleanup,
    } = await createTempFileKeypair())
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
      epochsToClaimSettlement: 1,
      withdrawLockupEpochs: 2,
    }))
    expect(
      provider.connection.getAccountInfo(configAccount)
    ).resolves.not.toBeNull()
    ;({ voteAccount } = await createVoteAccount(
      provider,
      undefined,
      undefined,
      voteWithdrawerKeypair
    ))
    ;({ bondAccount } = await executeInitBondInstruction(
      program,
      provider,
      configAccount,
      bondAuthorityKeypair,
      voteAccount,
      voteWithdrawerKeypair,
      33
    ))
  })

  afterEach(async () => {
    await bondAuthorityCleanup()
    await voteWithdrawerCleanup()
  })

  it('configure bond account', async () => {
    await (
      expect([
        'pnpm',
        [
          'cli',
          '-u',
          provider.connection.rpcEndpoint,
          '--program-id',
          program.programId.toBase58(),
          'configure-bond',
          bondAccount.toBase58(),
          '--authority',
          bondAuthorityPath,
          '--revenue-share',
          '42',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /Bond account.*successfully configured/,
    })

    const [, bump] = bondAddress(configAccount, voteAccount, program.programId)
    const bondsData1 = await getBond(program, bondAccount)
    expect(bondsData1.config).toEqual(configAccount)
    expect(bondsData1.validatorVoteAccount).toEqual(voteAccount)
    expect(bondsData1.authority).toEqual(bondAuthorityKeypair.publicKey)
    expect(bondsData1.revenueShare.hundredthBps).toEqual(42 * 10 ** 4)
    expect(bondsData1.bump).toEqual(bump)

    const newBondAuthority = PublicKey.unique()
    await (
      expect([
        'pnpm',
        [
          'cli',
          '-u',
          provider.connection.rpcEndpoint,
          '--program-id',
          program.programId.toBase58(),
          'configure-bond',
          '--config',
          configAccount.toBase58(),
          '--vote-account',
          voteAccount.toBase58(),
          '--authority',
          voteWithdrawerPath,
          '--bond-authority',
          newBondAuthority.toBase58(),
          '--revenue-share',
          43,
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /Bond account.*successfully configured/,
    })

    const bondsData2 = await getBond(program, bondAccount)
    expect(bondsData2.authority).toEqual(newBondAuthority)
    expect(bondsData2.revenueShare.hundredthBps).toEqual(43 * 10 ** 4)
  })

  it('configure bond in print-only mode', async () => {
    await (
      expect([
        'pnpm',
        [
          'cli',
          '-u',
          provider.connection.rpcEndpoint,
          '--program-id',
          program.programId.toBase58(),
          'configure-bond',
          bondAccount.toBase58(),
          '--authority',
          bondAuthorityKeypair.publicKey.toBase58(),
          '--bond-authority',
          PublicKey.unique().toBase58(),
          '--print-only',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /successfully configured/,
    })

    expect((await getBond(program, bondAccount)).authority).toEqual(
      bondAuthorityKeypair.publicKey
    )
  })
})
