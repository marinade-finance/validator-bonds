import assert from 'assert'

import { getAnchorValidatorInfo } from '@marinade.finance/anchor-common'
import { extendJestWithShellMatchers } from '@marinade.finance/jest-shell-matcher'
import { bondAddress, getBond } from '@marinade.finance/validator-bonds-sdk'
import { initTest } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testValidator'
import { createVoteAccountWithIdentity } from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/staking'
import { executeInitConfigInstruction } from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/testTransactions'
import { createTempFileKeypair } from '@marinade.finance/web3js-1x'
import {
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
} from '@solana/web3.js'

import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import type { ValidatorBondsProgram } from '@marinade.finance/validator-bonds-sdk'
import type { PublicKey } from '@solana/web3.js'

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

  beforeAll(() => {
    extendJestWithShellMatchers()
    ;({ provider, program } = initTest())
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
    assert((await provider.connection.getAccountInfo(configAccount)) != null)
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
    await provider.sendAndConfirm(tx)
    assert(
      (await provider.connection.getBalance(rentPayerKeypair.publicKey)) ===
        rentPayerFunds,
    )
  })

  afterEach(async () => {
    await rentPayerCleanup()
  })

  it('init bond account', async () => {
    const bondAuthority = Keypair.generate()

    await expect([
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
    ]).toHaveMatchingSpawnOutput({
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
    await expect([
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
    ]).toHaveMatchingSpawnOutput({
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
    await expect([
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
    ]).toHaveMatchingSpawnOutput({
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
    await expect([
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
    ]).toHaveMatchingSpawnOutput({
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
