import {
  createTempFileKeypair,
  createUserAndFund,
} from '@marinade.finance/web3js-common'
import { shellMatchers } from '@marinade.finance/jest-utils'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
  ValidatorBondsProgram,
} from '@marinade.finance/validator-bonds-sdk'
import { executeInitBondInstruction } from '../../../validator-bonds-sdk/__tests__/utils/testTransactions'
import { initTest } from '../../../validator-bonds-sdk/__tests__/test-validator/testValidator'
import { createVoteAccount } from '../../../validator-bonds-sdk/__tests__/utils/staking'
import { AnchorExtendedProvider } from '@marinade.finance/anchor-common'

describe('Init withdraw request using CLI (institutional)', () => {
  const stakeAccountLamports = LAMPORTS_PER_SOL * 88
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
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
    expect(
      await provider.connection.getAccountInfo(
        MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
      ),
    ).not.toBeNull()
    ;({ voteAccount } = await createVoteAccount({
      provider,
      validatorIdentity: validatorIdentityKeypair,
    }))
    await executeInitBondInstruction({
      program,
      provider,
      configAccount: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
      voteAccount,
    })
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
          'cli:institutional',
          '-u',
          provider.connection.rpcEndpoint,
          'init-withdraw-request',
          voteAccount.toBase58(),
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
  })
})
