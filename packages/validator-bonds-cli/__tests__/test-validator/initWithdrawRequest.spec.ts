import {
  U64_MAX,
  createTempFileKeypair,
  createUserAndFund,
} from '@marinade.finance/web3js-common'
import { shellMatchers } from '@marinade.finance/jest-utils'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  getWithdrawRequest,
  withdrawRequestAddress,
} from '@marinade.finance/validator-bonds-sdk'
import {
  executeCancelWithdrawRequestInstruction,
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testTransactions'
import { initTest } from '@marinade.finance/validator-bonds-sdk/__tests__/test-validator/testValidator'
import { createVoteAccount } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/staking'
import { AnchorExtendedProvider } from '@marinade.finance/anchor-common'

describe('Init withdraw request using CLI', () => {
  const stakeAccountLamports = LAMPORTS_PER_SOL * 88
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let bondAccount: PublicKey
  let voteAccount: PublicKey
  let validatorIdentityPath: string
  let validatorIdentityKeypair: Keypair
  let validatorIdentityCleanup: () => Promise<void>
  let rentPayerPath: string
  let rentPayerKeypair: Keypair
  let rentPayerCleanup: () => Promise<void>

  beforeAll(async () => {
    shellMatchers()
    ;({ provider, program } = await initTest())
  })

  beforeEach(async () => {
    ;({
      path: validatorIdentityPath,
      keypair: validatorIdentityKeypair,
      cleanup: validatorIdentityCleanup,
    } = await createTempFileKeypair())
    ;({
      path: rentPayerPath,
      keypair: rentPayerKeypair,
      cleanup: rentPayerCleanup,
    } = await createTempFileKeypair())
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
    }))
    expect(
      provider.connection.getAccountInfo(configAccount)
    ).resolves.not.toBeNull()
    ;({ voteAccount } = await createVoteAccount({
      provider,
      validatorIdentity: validatorIdentityKeypair,
    }))
    ;({ bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount,
    }))
  })

  afterEach(async () => {
    await validatorIdentityCleanup()
    await rentPayerCleanup()
  })

  it('init withdraw request', async () => {
    const userFunding = LAMPORTS_PER_SOL
    await createUserAndFund({
      provider,
      lamports: userFunding,
      user: rentPayerKeypair,
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
          'init-withdraw-request',
          bondAccount.toBase58(),
          '--config',
          configAccount.toBase58(),
          '--authority',
          validatorIdentityPath,
          '--amount',
          stakeAccountLamports.toString(),
          '--rent-payer',
          rentPayerPath,
          '--confirmation-finality',
          'confirmed',
          '--verbose',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /successfully initialized/,
    })

    const [withdrawRequestAddr] = withdrawRequestAddress(
      bondAccount,
      program.programId
    )
    const withdrawRequestData = await getWithdrawRequest(
      program,
      withdrawRequestAddr
    )
    expect(withdrawRequestData.bond).toEqual(bondAccount)
    expect(withdrawRequestData.voteAccount).toEqual(voteAccount)
    expect(withdrawRequestData.withdrawnAmount).toEqual(0)
    expect(withdrawRequestData.requestedAmount).toEqual(stakeAccountLamports)
    const rentExempt = (
      await provider.connection.getAccountInfo(withdrawRequestAddr)
    )?.lamports
    expect(
      (await provider.connection.getAccountInfo(rentPayerKeypair.publicKey))
        ?.lamports
    ).toEqual(userFunding - rentExempt!)

    await executeCancelWithdrawRequestInstruction(
      program,
      provider,
      withdrawRequestAddr,
      validatorIdentityKeypair
    )
    expect(
      provider.connection.getAccountInfo(withdrawRequestAddr)
    ).resolves.toBeNull()

    await (
      expect([
        'pnpm',
        [
          'cli',
          '-u',
          provider.connection.rpcEndpoint,
          '--program-id',
          program.programId.toBase58(),
          'init-withdraw-request',
          bondAccount.toBase58(),
          '--config',
          configAccount.toBase58(),
          '--authority',
          validatorIdentityPath,
          '--amount',
          'ALL',
          '--confirmation-finality',
          'confirmed',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /successfully initialized/,
    })
    const withdrawRequestDataAll = await getWithdrawRequest(
      program,
      withdrawRequestAddr
    )
    expect(withdrawRequestDataAll.bond).toEqual(bondAccount)
    expect(withdrawRequestDataAll.requestedAmount).toEqual(U64_MAX)
  })

  it('init withdraw request in print-only mode', async () => {
    const [withdrawRequestAddr] = withdrawRequestAddress(
      bondAccount,
      program.programId
    )
    const toMatch = new RegExp(
      `${withdrawRequestAddr.toBase58()}.*successfully initialized`
    )
    await (
      expect([
        'pnpm',
        [
          'cli',
          '-u',
          provider.connection.rpcEndpoint,
          '--program-id',
          program.programId.toBase58(),
          'init-withdraw-request',
          voteAccount.toBase58(),
          '--config',
          configAccount.toBase58(),
          '--authority',
          validatorIdentityPath,
          '--amount',
          '1',
          '--print-only',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: toMatch,
    })

    expect(
      provider.connection.getAccountInfo(withdrawRequestAddr)
    ).resolves.toBeNull()
  })
})
