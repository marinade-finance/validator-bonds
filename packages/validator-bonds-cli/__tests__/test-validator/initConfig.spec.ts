import { AnchorProvider } from '@coral-xyz/anchor'
import { createTempFileKeypair } from '@marinade.finance/web3js-common'
import { shellMatchers } from '@marinade.finance/jest-utils'
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
import { initTest } from './utils'

describe('Init config account using CLI', () => {
  let provider: AnchorProvider
  let program: ValidatorBondsProgram
  let configPath: string
  let configKeypair: Keypair
  let configCleanup: () => Promise<void>

  beforeAll(async () => {
    shellMatchers()
    ;({ provider, program } = await initTest())
  })

  beforeEach(async () => {
    ;({
      path: configPath,
      keypair: configKeypair,
      cleanup: configCleanup,
    } = await createTempFileKeypair())
  })

  afterEach(async () => {
    await configCleanup()
  })

  it('inits config account', async () => {
    const {
      keypair: rentPayerKeypair,
      path: rentPayerPath,
      cleanup: cleanupRentPayer,
    } = await createTempFileKeypair()
    const rentPayerFunds = 10 * LAMPORTS_PER_SOL
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: rentPayerKeypair.publicKey,
        lamports: rentPayerFunds,
      })
    )
    await provider.sendAndConfirm!(tx)
    await expect(
      provider.connection.getBalance(rentPayerKeypair.publicKey)
    ).resolves.toStrictEqual(rentPayerFunds)

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
            '--withdraw-lockup-epochs',
            43,
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
    expect(configData.withdrawLockupEpochs).toEqual(43)
    await expect(
      provider.connection.getBalance(rentPayerKeypair.publicKey)
    ).resolves.toBeLessThan(rentPayerFunds)
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
    await expect(
      provider.connection.getAccountInfo(configKeypair.publicKey)
    ).resolves.toBeNull()
  })
})
