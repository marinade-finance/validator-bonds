import { createTempFileKeypair } from '@marinade.finance/web3js-common'
import { shellMatchers } from '@marinade.finance/jest-utils'
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  bondAddress,
  getBond,
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
  let rentPayerPath: string
  let rentPayerKeypair: Keypair
  let rentPayerCleanup: () => Promise<void>
  const rentPayerFunds = 10 * LAMPORTS_PER_SOL
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
      path: rentPayerPath,
      keypair: rentPayerKeypair,
      cleanup: rentPayerCleanup,
    } = await createTempFileKeypair())
    ;({
      path: voteWithdrawerPath,
      keypair: voteWithdrawerKeypair,
      cleanup: voteWithdrawerCleanup,
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
  })

  afterEach(async () => {
    await rentPayerCleanup()
    await voteWithdrawerCleanup()
  })

  it('init bond account', async () => {
    const bondAuthority = Keypair.generate()

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
          '--vote-account',
          voteAccount.toBase58(),
          '--vote-account-withdrawer',
          voteWithdrawerPath,
          '--bond-authority',
          bondAuthority.publicKey.toBase58(),
          '--revenue-share',
          '10',
          '--rent-payer',
          rentPayerPath,
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /Bond account.*successfully created/,
    })

    const [bondAccount, bump] = bondAddress(
      configAccount,
      voteAccount,
      program.programId
    )
    const bondsData = await getBond(program, bondAccount)
    expect(bondsData.config).toEqual(configAccount)
    expect(bondsData.validatorVoteAccount).toEqual(voteAccount)
    expect(bondsData.authority).toEqual(bondAuthority.publicKey)
    expect(bondsData.revenueShare.hundredthBps).toEqual(10 * 10 ** 4)
    expect(bondsData.bump).toEqual(bump)
    await expect(
      provider.connection.getBalance(rentPayerKeypair.publicKey)
    ).resolves.toBeLessThan(rentPayerFunds)
  })

  it('init bond in print-only mode', async () => {
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
          '--vote-account',
          voteAccount.toBase58(),
          '--print-only',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /successfully created/,
    })
    const [bondAccount] = bondAddress(
      configAccount,
      voteAccount,
      program.programId
    )
    await expect(
      provider.connection.getAccountInfo(bondAccount)
    ).resolves.toBeNull()
  })
})
