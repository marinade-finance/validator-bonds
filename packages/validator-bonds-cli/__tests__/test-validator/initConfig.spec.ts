import { createTempFileKeypair } from '@marinade.finance/web3js-1x'
import { extendJestWithShellMatchers } from '@marinade.finance/jest-shell-matcher'
import {
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
} from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  getConfig,
} from '@marinade.finance/validator-bonds-sdk'
import { initTest } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testValidator'
import { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import { airdrop } from './utils'

describe('Init config account using CLI', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let configPath: string
  let configKeypair: Keypair
  let configCleanup: () => Promise<void>
  let keypairFeePayerPath: string
  let keypairFeePayerKeypair: Keypair
  let keypairFeePayerCleanup: () => Promise<void>

  beforeAll(async () => {
    extendJestWithShellMatchers()
    ;({ provider, program } = await initTest())
  })

  beforeEach(async () => {
    ;({
      path: configPath,
      keypair: configKeypair,
      cleanup: configCleanup,
    } = await createTempFileKeypair())
    ;({
      path: keypairFeePayerPath,
      keypair: keypairFeePayerKeypair,
      cleanup: keypairFeePayerCleanup,
    } = await createTempFileKeypair())
    await airdrop(provider.connection, keypairFeePayerKeypair.publicKey)
  })

  afterEach(async () => {
    await configCleanup()
    await keypairFeePayerCleanup()
  })

  it('inits config account', async () => {
    const {
      keypair: rentPayerKeypair,
      path: rentPayerPath,
      cleanup: cleanupRentPayer,
    } = await createTempFileKeypair()
    const rentPayerFunds = 10 * LAMPORTS_PER_SOL
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: rentPayerKeypair.publicKey,
          lamports: rentPayerFunds,
        }),
      ),
    )
    expect(
      await provider.connection.getBalance(rentPayerKeypair.publicKey),
    ).toStrictEqual(rentPayerFunds)

    const admin = Keypair.generate().publicKey
    const operator = Keypair.generate().publicKey
    try {
      await (
        expect([
          'pnpm',
          [
            'cli',
            '-u',
            provider.connection.rpcEndpoint,
            '-k',
            keypairFeePayerPath,
            '--program-id',
            program.programId.toBase58(),
            'init-config',
            '--address',
            configPath,
            '--admin',
            admin.toBase58(),
            '--operator',
            operator.toBase58(),
            '--rent-payer',
            rentPayerPath,
            '--epochs-to-claim-settlement',
            42,
            '--slots-to-start-settlement-claiming',
            11,
            '--withdraw-lockup-epochs',
            43,
            '--confirmation-finality',
            'confirmed',
            '-v',
          ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ]) as any
      ).toHaveMatchingSpawnOutput({
        code: 0,
        // stderr: '',
        stdout: /successfully created/,
      })
    } finally {
      await cleanupRentPayer()
    }

    const configData = await getConfig(program, configKeypair.publicKey)
    expect(configData.adminAuthority).toEqual(admin)
    expect(configData.operatorAuthority).toEqual(operator)
    expect(configData.epochsToClaimSettlement).toEqual(42)
    expect(configData.slotsToStartSettlementClaiming).toEqual(11)
    expect(configData.withdrawLockupEpochs).toEqual(43)
    expect(
      await provider.connection.getBalance(rentPayerKeypair.publicKey),
    ).toBeLessThan(rentPayerFunds)
  })

  it('fails with low compute unit limit', async () => {
    await (
      expect([
        'pnpm',
        [
          'cli',
          '-u',
          provider.connection.rpcEndpoint,
          '-k',
          keypairFeePayerPath,
          '--program-id',
          program.programId.toBase58(),
          'init-config',
          '--address',
          configPath,
          '--simulate',
          '--compute-unit-limit',
          1,
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 200,
      stdout: /exceeded CUs meter/,
    })
    expect(
      await provider.connection.getAccountInfo(configKeypair.publicKey),
    ).toBeNull()
  })

  // this is a "mock test" that just checks that print only command works
  it('creates config in print-only mode', async () => {
    await (
      expect([
        'pnpm',
        [
          'cli',
          '-u',
          provider.connection.rpcEndpoint,
          '-k',
          keypairFeePayerPath,
          '--program-id',
          program.programId.toBase58(),
          'init-config',
          '--address',
          configPath,
          '--print-only',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /successfully created/,
    })
    expect(
      await provider.connection.getAccountInfo(configKeypair.publicKey),
    ).toBeNull()
  })
})
