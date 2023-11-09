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
  VALIDATOR_BONDS_PROGRAM_ID,
  getConfig,
  getProgram,
} from '@marinade.finance/validator-bonds-sdk'

beforeAll(() => {
  shellMatchers()
})

describe('Init config account using CLI', () => {
  const provider = AnchorProvider.env()
  provider.opts.skipPreflight = true
  const program = getProgram({
    connection: provider,
    programId: VALIDATOR_BONDS_PROGRAM_ID,
  })

  let configPath: string
  let configKeypair: Keypair
  let configCleanup: () => Promise<void>

  beforeEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
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

  it('creates config in print-only mode', async () => {
    // this is a "mock test" that just checks that print only command works
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
