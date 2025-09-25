import assert from 'assert'

import { getAnchorValidatorInfo } from '@marinade.finance/anchor-common'
import { extendJestWithShellMatchers } from '@marinade.finance/jest-shell-matcher'
import {
  bondAddress,
  getBond,
  bondMintAddress,
} from '@marinade.finance/validator-bonds-sdk'
import { initTest } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testValidator'
import { createVoteAccountWithIdentity } from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/staking'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/testTransactions'
import {
  createTempFileKeypair,
  createUserAndFund,
  pubkey,
} from '@marinade.finance/web3js-1x'
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount as getTokenAccount,
  getAssociatedTokenAddressSync,
} from 'solana-spl-token-modern'

import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import type { ValidatorBondsProgram } from '@marinade.finance/validator-bonds-sdk'
import type { Keypair } from '@solana/web3.js'

jest.setTimeout(5000 * 1000)

describe('Configure bond account using CLI', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let bondAuthorityPath: string
  let bondAuthorityKeypair: Keypair
  let bondAuthorityCleanup: () => Promise<void>
  let userPath: string
  let userKeypair: Keypair
  let userCleanup: () => Promise<void>
  let configAccount: PublicKey
  let bondAccount: PublicKey
  let voteAccount: PublicKey
  let validatorIdentity: Keypair
  let validatorIdentityPath: string

  beforeAll(() => {
    extendJestWithShellMatchers()
    ;({ provider, program } = initTest())
  })

  beforeEach(async () => {
    ;({
      path: bondAuthorityPath,
      keypair: bondAuthorityKeypair,
      cleanup: bondAuthorityCleanup,
    } = await createTempFileKeypair())
    ;({
      path: userPath,
      keypair: userKeypair,
      cleanup: userCleanup,
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
      validatorIdentity
    ))
    ;({ bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      bondAuthority: bondAuthorityKeypair,
      voteAccount,
      validatorIdentity,
      cpmpe: 33,
      maxStakeWanted: 55,
    }))
  })

  afterEach(async () => {
    await bondAuthorityCleanup()
    await userCleanup()
  })

  it('configure bond account', async () => {
    await expect([
      'pnpm',
      [
        'cli',
        '-u',
        provider.connection.rpcEndpoint,
        '--program-id',
        program.programId.toBase58(),
        'configure-bond',
        bondAccount.toBase58(),
        '--authority',
        bondAuthorityPath,
        '--confirmation-finality',
        'confirmed',
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /Bond account.*successfully configured/,
    })

    const [, bump] = bondAddress(configAccount, voteAccount, program.programId)
    const bondsData1 = await getBond(program, bondAccount)
    expect(bondsData1.config).toEqual(configAccount)
    expect(bondsData1.voteAccount).toEqual(voteAccount)
    expect(bondsData1.authority).toEqual(bondAuthorityKeypair.publicKey)
    expect(bondsData1.cpmpe).toEqual(33)
    expect(bondsData1.maxStakeWanted).toEqual(55)
    expect(bondsData1.bump).toEqual(bump)

    const newBondAuthority = PublicKey.unique()
    await expect([
      'pnpm',
      [
        'cli',
        '-u',
        provider.connection.rpcEndpoint,
        '--program-id',
        program.programId.toBase58(),
        'configure-bond',
        voteAccount.toBase58(),
        '--config',
        configAccount.toBase58(),
        '--authority',
        validatorIdentityPath,
        '--bond-authority',
        newBondAuthority.toBase58(),
        '--cpmpe',
        32,
        '--max-stake-wanted',
        1000_000_000_000,
        '--confirmation-finality',
        'confirmed',
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /Bond account.*successfully configured/,
    })

    const bondsData2 = await getBond(program, bondAccount)
    expect(bondsData2.authority).toEqual(newBondAuthority)
    expect(bondsData2.cpmpe).toEqual(32)
    expect(bondsData2.maxStakeWanted).toEqual(1000 * LAMPORTS_PER_SOL)
  })

  it('configure bond account with mint', async () => {
    await expect([
      'pnpm',
      [
        'cli',
        '-u',
        provider.connection.rpcEndpoint,
        '--program-id',
        program.programId.toBase58(),
        'mint-bond',
        bondAccount.toBase58(),
        '--confirmation-finality',
        'confirmed',
        '--verbose',
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /Bond.*was minted successfully/,
    })

    const [bondMint] = bondMintAddress(
      bondAccount,
      validatorIdentity.publicKey,
      program.programId
    )
    const validatorIdentityBondAta = getAssociatedTokenAddressSync(
      bondMint,
      validatorIdentity.publicKey,
      true
    )
    const tokenAccountValidatorIdentity = await getTokenAccount(
      provider.connection,
      validatorIdentityBondAta
    )
    expect(tokenAccountValidatorIdentity.amount).toEqual(1)
    const user = await createUserAndFund({
      provider,
      user: userKeypair,
      from: provider.wallet,
    })
    const userTokenBondAta = getAssociatedTokenAddressSync(
      bondMint,
      pubkey(user),
      true
    )
    const createTokenIx = createAssociatedTokenAccountInstruction(
      provider.wallet.publicKey,
      userTokenBondAta,
      pubkey(user),
      bondMint
    )
    const transferIx = createTransferInstruction(
      validatorIdentityBondAta,
      userTokenBondAta,
      pubkey(validatorIdentity),
      1
    )
    await provider.sendIx([validatorIdentity], createTokenIx, transferIx)

    const newBondAuthority = PublicKey.unique()
    await expect([
      'pnpm',
      [
        'cli',
        '-u',
        provider.connection.rpcEndpoint,
        '--program-id',
        program.programId.toBase58(),
        'configure-bond',
        voteAccount.toBase58(),
        '--config',
        configAccount.toBase58(),
        '--authority',
        userPath,
        '--bond-authority',
        newBondAuthority.toBase58(),
        '--cpmpe',
        2,
        '--max-stake-wanted',
        999000000000,
        '--with-token',
        '--confirmation-finality',
        'confirmed',
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /Bond account.*successfully configured/,
    })

    const bondsData = await getBond(program, bondAccount)
    expect(bondsData.authority).toEqual(newBondAuthority)
    expect(bondsData.cpmpe).toEqual(2)
    expect(bondsData.maxStakeWanted).toEqual(999 * LAMPORTS_PER_SOL)
  })

  it('configure bond in print-only mode', async () => {
    await expect([
      'pnpm',
      [
        'cli',
        '-u',
        provider.connection.rpcEndpoint,
        '--program-id',
        program.programId.toBase58(),
        'configure-bond',
        bondAccount.toBase58(),
        '--authority',
        bondAuthorityKeypair.publicKey.toBase58(),
        '--bond-authority',
        PublicKey.unique().toBase58(),
        '--print-only',
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /successfully configured/,
    })

    expect((await getBond(program, bondAccount)).authority).toEqual(
      bondAuthorityKeypair.publicKey
    )
  })
})
