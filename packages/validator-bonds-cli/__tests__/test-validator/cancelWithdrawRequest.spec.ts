import { createTempFileKeypair, pubkey } from '@marinade.finance/web3js-common'
import { shellMatchers } from '@marinade.finance/jest-utils'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  getWithdrawRequest,
} from '@marinade.finance/validator-bonds-sdk'
import {
  createUserAndFund,
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitWithdrawRequestInstruction,
} from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testTransactions'
import {
  AnchorExtendedProvider,
  initTest,
} from '@marinade.finance/validator-bonds-sdk/__tests__/test-validator/testValidator'
import { createVoteAccount } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/staking'
import { rand } from '@marinade.finance/ts-common'

describe('Cancel withdraw request using CLI', () => {
  let stakeAccountLamports: number
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let bondAccount: PublicKey
  let voteAccount: PublicKey
  let withdrawRequestAccount: PublicKey
  let validatorIdentityPath: string
  let validatorIdentityKeypair: Keypair
  let validatorIdentityCleanup: () => Promise<void>

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
    stakeAccountLamports = LAMPORTS_PER_SOL * rand(99, 5)
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
    ;({ withdrawRequestAccount } = await executeInitWithdrawRequestInstruction({
      program,
      provider,
      configAccount,
      bondAccount,
      validatorIdentity: validatorIdentityKeypair,
      amount: stakeAccountLamports,
    }))
  })

  afterEach(async () => {
    await validatorIdentityCleanup()
  })

  it('cancel withdraw request', async () => {
    const withdrawRequestData = await getWithdrawRequest(
      program,
      withdrawRequestAccount
    )
    expect(withdrawRequestData.requestedAmount).toEqual(stakeAccountLamports)
    const rentExempt = (
      await provider.connection.getAccountInfo(withdrawRequestAccount)
    )?.lamports
    const userFunding = LAMPORTS_PER_SOL
    const user = await createUserAndFund(provider, userFunding)

    await (
      expect([
        'pnpm',
        [
          'cli',
          '-u',
          provider.connection.rpcEndpoint,
          '--program-id',
          program.programId.toBase58(),
          'cancel-withdraw-request',
          bondAccount.toBase58(),
          '--config',
          configAccount.toBase58(),
          '--authority',
          validatorIdentityPath,
          '--rent-collector',
          pubkey(user).toBase58(),
          '--confirmation-finality',
          'confirmed',
          '--verbose',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /successfully cancelled/,
    })

    expect(
      provider.connection.getAccountInfo(withdrawRequestAccount)
    ).resolves.toBeNull()
    expect(
      (await provider.connection.getAccountInfo(pubkey(user)))?.lamports
    ).toEqual(userFunding + rentExempt!)
  })

  it('cancel withdraw request in print-only mode', async () => {
    const toMatch = new RegExp(
      `${withdrawRequestAccount.toBase58()}.*successfully cancelled`
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
          'cancel-withdraw-request',
          voteAccount.toBase58(),
          '--config',
          configAccount.toBase58(),
          '--authority',
          validatorIdentityKeypair.publicKey.toBase58(),
          '--print-only',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: toMatch,
    })

    const withdrawRequestData = await getWithdrawRequest(
      program,
      withdrawRequestAccount
    )
    expect(withdrawRequestData.requestedAmount).toEqual(stakeAccountLamports)
  })
})
