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
import { executeInitConfigInstruction } from '../../../validator-bonds-sdk/__tests__/utils/testTransactions'
import { initTest } from '../../../validator-bonds-sdk/__tests__/test-validator/testValidator'
import { createVoteAccountWithIdentity } from '../../../validator-bonds-sdk/__tests__/utils/staking'
import {
  AnchorExtendedProvider,
  getAnchorValidatorInfo,
} from '@marinade.finance/anchor-common'

describe('Init bond account using CLI', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let rentPayerPath: string
  let rentPayerKeypair: Keypair
  let rentPayerCleanup: () => Promise<void>
  const rentPayerFunds = 10 * LAMPORTS_PER_SOL
  let configAccount: PublicKey
  let voteAccount: PublicKey
  let validatorIdentity: Keypair
  let validatorIdentityPath: string

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
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
      epochsToClaimSettlement: 1,
      withdrawLockupEpochs: 2,
    }))
    expect(
      await provider.connection.getAccountInfo(configAccount),
    ).not.toBeNull()
    ;({ validatorIdentity, validatorIdentityPath } =
      await getAnchorValidatorInfo(provider.connection))
    ;({ voteAccount } = await createVoteAccountWithIdentity(
      provider,
      validatorIdentity,
    ))

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: rentPayerKeypair.publicKey,
        lamports: rentPayerFunds,
      }),
    )
    await provider.sendAndConfirm!(tx)
    expect(
      await provider.connection.getBalance(rentPayerKeypair.publicKey),
    ).toStrictEqual(rentPayerFunds)
  })

  afterEach(async () => {
    await rentPayerCleanup()
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
          '--validator-identity',
          validatorIdentityPath,
          '--bond-authority',
          bondAuthority.publicKey.toBase58(),
          '--rent-payer',
          rentPayerPath,
          '--cpmpe',
          33,
          '--max-stake-wanted',
          1000_000_000_000,
          '--confirmation-finality',
          'confirmed',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /Bond account .* successfully created/,
    })

    const [bondAccount, bump] = bondAddress(
      configAccount,
      voteAccount,
      program.programId,
    )
    const bondsData = await getBond(program, bondAccount)
    expect(bondsData.config).toEqual(configAccount)
    expect(bondsData.voteAccount).toEqual(voteAccount)
    expect(bondsData.authority).toEqual(bondAuthority.publicKey)
    expect(bondsData.cpmpe).toEqual(33)
    expect(bondsData.maxStakeWanted).toEqual(1000 * LAMPORTS_PER_SOL)
    expect(bondsData.bump).toEqual(bump)
    expect(
      await provider.connection.getBalance(rentPayerKeypair.publicKey),
    ).toBeLessThan(rentPayerFunds)
  })

  it('init bond account permission-ed with default values', async () => {
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
          '--validator-identity',
          validatorIdentityPath,
          '--rent-payer',
          rentPayerPath,
          '--confirmation-finality',
          'confirmed',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /Bond account .* successfully created/,
    })

    const [bondAccount, bump] = bondAddress(
      configAccount,
      voteAccount,
      program.programId,
    )
    const bondsData = await getBond(program, bondAccount)
    expect(bondsData.config).toEqual(configAccount)
    expect(bondsData.voteAccount).toEqual(voteAccount)
    expect(bondsData.authority).toEqual(validatorIdentity.publicKey)
    expect(bondsData.cpmpe).toEqual(0)
    expect(bondsData.maxStakeWanted).toEqual(0)
    expect(bondsData.bump).toEqual(bump)
    expect(
      await provider.connection.getBalance(rentPayerKeypair.publicKey),
    ).toBeLessThan(rentPayerFunds)
  })

  it('init bond account permission-less', async () => {
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
          '--max-stake-wanted',
          1000000000000,
          '--confirmation-finality',
          'confirmed',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /Bond account .* successfully created/,
    })

    const [bondAccount, bump] = bondAddress(
      configAccount,
      voteAccount,
      program.programId,
    )
    const bondsData = await getBond(program, bondAccount)
    expect(bondsData.config).toEqual(configAccount)
    expect(bondsData.voteAccount).toEqual(voteAccount)
    expect(bondsData.authority).toEqual(validatorIdentity.publicKey)
    expect(bondsData.cpmpe).toEqual(0)
    expect(bondsData.maxStakeWanted).toEqual(0)
    expect(bondsData.bump).toEqual(bump)
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
      program.programId,
    )
    expect(await provider.connection.getAccountInfo(bondAccount)).toBeNull()
  })
})
