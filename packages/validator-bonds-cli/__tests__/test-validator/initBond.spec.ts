import assert from 'assert'

import { getAnchorValidatorInfo } from '@marinade.finance/anchor-common'
import { extendJestWithShellMatchers } from '@marinade.finance/jest-shell-matcher'
import { NULL_LOG } from '@marinade.finance/ts-common'
import {
  ProductTypes,
  bondAddress,
  bondProductAddress,
  findBondProducts,
  getBond,
  getBondProduct,
} from '@marinade.finance/validator-bonds-sdk'
import { initTest } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testValidator'
import { createVoteAccountWithIdentity } from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/staking'
import { executeInitConfigInstruction } from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/testTransactions'
import { createTempFileKeypair } from '@marinade.finance/web3js-1x'
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js'

import { airdrop } from './utils'

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

    await airdrop(
      provider.connection,
      rentPayerKeypair.publicKey,
      rentPayerFunds,
    )
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
        '--inflation-commission',
        101,
        '--mev-commission',
        102,
        '--block-commission',
        103,
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

    const [bondProduct, bumpProduct] = bondProductAddress(
      bondAccount,
      ProductTypes.commission,
      program.programId,
    )
    const commissionProducts = await findBondProducts({
      program,
      bond: bondAccount,
      productType: ProductTypes.commission,
      logger: NULL_LOG,
    })
    expect(commissionProducts).not.toBeUndefined()
    expect(commissionProducts.length).toEqual(1)
    expect(bondProduct).toEqual(commissionProducts[0]!.publicKey)
    const commissionProduct = commissionProducts[0]!.account
    expect(commissionProduct.bond).toEqual(bondAccount)
    expect(commissionProduct.bump).toEqual(bumpProduct)
    expect(commissionProduct.config).toEqual(configAccount)
    expect(commissionProduct.productType).toEqual(ProductTypes.commission)
    expect(commissionProduct.voteAccount).toEqual(voteAccount)
    const commissionData = commissionProduct.configData.commission![0]
    expect(commissionData.inflationBps).toEqual(101)
    expect(commissionData.mevBps).toEqual(102)
    expect(commissionData.blockBps).toEqual(103)
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

    const commissionProduct = await findBondProducts({
      program,
      bond: bondAccount,
      productType: ProductTypes.commission,
      logger: NULL_LOG,
    })
    expect(commissionProduct).not.toBeUndefined()
    expect(commissionProduct.length).toEqual(1)
    const commissionData =
      commissionProduct[0]!.account.configData.commission![0]
    expect(commissionData.inflationBps).toBeNull()
    expect(commissionData.mevBps).toBeNull()
    expect(commissionData.blockBps).toBeNull()
  })

  it('init bond account permission-ed with uniform commission', async () => {
    const unifiedCommissionBps = 142
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
        '--uniform-commission',
        unifiedCommissionBps,
        '--confirmation-finality',
        'confirmed',
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /Bond account .* successfully created/,
    })

    const [bondAccount] = bondAddress(
      configAccount,
      voteAccount,
      program.programId,
    )
    await expect(getBond(program, bondAccount)).resolves.toBeDefined()

    const [bondProduct] = bondProductAddress(
      bondAccount,
      ProductTypes.commission,
      program.programId,
    )
    const commissionData = (await getBondProduct(program, bondProduct))
      .configData.commission![0]
    expect(commissionData.inflationBps).toEqual(unifiedCommissionBps)
    expect(commissionData.mevBps).toEqual(unifiedCommissionBps)
    expect(commissionData.blockBps).toEqual(unifiedCommissionBps)
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
        '--mev-commission',
        103,
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

    const commissionProduct = await findBondProducts({
      program,
      bond: bondAccount,
      productType: ProductTypes.commission,
      logger: NULL_LOG,
    })
    expect(commissionProduct).not.toBeUndefined()
    expect(commissionProduct.length).toEqual(1)
    const commissionData =
      commissionProduct[0]!.account.configData.commission![0]
    expect(commissionData.inflationBps).toBeNull()
    expect(commissionData.mevBps).toBeNull()
    expect(commissionData.blockBps).toBeNull()
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
    const [bondProduct] = bondProductAddress(
      bondAccount,
      ProductTypes.commission,
      program.programId,
    )
    expect(await provider.connection.getAccountInfo(bondProduct)).toBeNull()
  })
})
