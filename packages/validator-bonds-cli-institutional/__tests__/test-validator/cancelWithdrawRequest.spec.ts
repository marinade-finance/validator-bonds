import {
  createTempFileKeypair,
  createUserAndFund,
  pubkey,
} from '@marinade.finance/web3js-1x'
import { extendJestWithShellMatchers } from '@marinade.finance/jest-shell-matcher'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
  ValidatorBondsProgram,
  getWithdrawRequest,
} from '@marinade.finance/validator-bonds-sdk'
import {
  executeInitBondInstruction,
  executeInitWithdrawRequestInstruction,
} from '../../../validator-bonds-sdk/__tests__/utils/testTransactions'
import { initTest } from '../../../validator-bonds-sdk/__tests__/test-validator/testValidator'
import { createVoteAccount } from '../../../validator-bonds-sdk/__tests__/utils/staking'
import { rand } from '@marinade.finance/ts-common'
import { AnchorExtendedProvider } from '@marinade.finance/anchor-common'

describe('Cancel withdraw request using CLI (institutional)', () => {
  let stakeAccountLamports: number
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let bondAccount: PublicKey
  let voteAccount: PublicKey
  let withdrawRequestAccount: PublicKey
  let validatorIdentityPath: string
  let validatorIdentityKeypair: Keypair
  let validatorIdentityCleanup: () => Promise<void>

  beforeAll(async () => {
    extendJestWithShellMatchers()
    ;({ provider, program } = await initTest())
  })

  beforeEach(async () => {
    ;({
      path: validatorIdentityPath,
      keypair: validatorIdentityKeypair,
      cleanup: validatorIdentityCleanup,
    } = await createTempFileKeypair())
    stakeAccountLamports = LAMPORTS_PER_SOL * rand(99, 5)
    expect(
      await provider.connection.getAccountInfo(
        MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
      ),
    ).not.toBeNull()
    ;({ voteAccount } = await createVoteAccount({
      provider,
      validatorIdentity: validatorIdentityKeypair,
    }))
    ;({ bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
      voteAccount,
    }))
    ;({ withdrawRequestAccount } = await executeInitWithdrawRequestInstruction({
      program,
      provider,
      configAccount: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
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
      withdrawRequestAccount,
    )
    expect(withdrawRequestData.requestedAmount).toEqual(stakeAccountLamports)
    const rentExempt = (
      await provider.connection.getAccountInfo(withdrawRequestAccount)
    )?.lamports
    const userFunding = LAMPORTS_PER_SOL
    const user = await createUserAndFund({ provider, lamports: userFunding })
    expect(await provider.connection.getAccountInfo(voteAccount)).not.toBeNull()

    await (
      expect([
        'pnpm',
        [
          'cli:institutional',
          '-u',
          provider.connection.rpcEndpoint,
          'cancel-withdraw-request',
          voteAccount.toBase58(),
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
      await provider.connection.getAccountInfo(withdrawRequestAccount),
    ).toBeNull()
    expect(
      (await provider.connection.getAccountInfo(pubkey(user)))?.lamports,
    ).toEqual(userFunding + rentExempt!)
  })
})
