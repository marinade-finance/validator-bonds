import {
  createTempFileKeypair,
  createUserAndFund,
  pubkey,
} from '@marinade.finance/web3js-1x'
import { extendJestWithShellMatchers } from '@marinade.finance/jest-shell-matcher'
import { Keypair, PublicKey } from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  bondAddress,
  getBond,
  bondMintAddress,
  MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
} from '@marinade.finance/validator-bonds-sdk'
import { executeInitBondInstruction } from '../../../validator-bonds-sdk/__tests__/utils/testTransactions'
import { initTest } from '../../..//validator-bonds-sdk/__tests__/test-validator/testValidator'
import {
  AnchorExtendedProvider,
  getAnchorValidatorInfo,
} from '@marinade.finance/anchor-common'
import { createVoteAccountWithIdentity } from '../../../validator-bonds-sdk/__tests__/utils/staking'
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount as getTokenAccount,
  getAssociatedTokenAddressSync,
} from 'solana-spl-token-modern'

jest.setTimeout(5000 * 1000)

describe('Configure bond account using CLI (institutional)', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let bondAuthorityPath: string
  let bondAuthorityKeypair: Keypair
  let bondAuthorityCleanup: () => Promise<void>
  let userPath: string
  let userKeypair: Keypair
  let userCleanup: () => Promise<void>
  let bondAccount: PublicKey
  let voteAccount: PublicKey
  let validatorIdentity: Keypair

  beforeAll(async () => {
    extendJestWithShellMatchers()
    ;({ provider, program } = await initTest())
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
    expect(
      await provider.connection.getAccountInfo(
        MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
      ),
    ).not.toBeNull()
    ;({ validatorIdentity } = await getAnchorValidatorInfo(provider.connection))
    ;({ voteAccount } = await createVoteAccountWithIdentity(
      provider,
      validatorIdentity,
    ))
    ;({ bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
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

  it('Configure bond account CLI (institutional)', async () => {
    await (
      expect([
        'pnpm',
        [
          'cli:institutional',
          '-u',
          provider.connection.rpcEndpoint,
          'configure-bond',
          bondAccount.toBase58(),
          '--authority',
          bondAuthorityPath,
          '--confirmation-finality',
          'confirmed',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /Bond account.*successfully configured/,
    })

    const [, bump] = bondAddress(
      MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
      voteAccount,
      program.programId,
    )
    const bondsData1 = await getBond(program, bondAccount)
    expect(bondsData1.config).toEqual(MARINADE_INSTITUTIONAL_CONFIG_ADDRESS)
    expect(bondsData1.voteAccount).toEqual(voteAccount)
    expect(bondsData1.authority).toEqual(bondAuthorityKeypair.publicKey)
    expect(bondsData1.cpmpe).toEqual(33)
    expect(bondsData1.maxStakeWanted).toEqual(55)
    expect(bondsData1.bump).toEqual(bump)
  })

  it('configure bond account with mint (institutional)', async () => {
    await (
      expect([
        'pnpm',
        [
          'cli:institutional',
          '-u',
          provider.connection.rpcEndpoint,
          'mint-bond',
          bondAccount.toBase58(),
          '--confirmation-finality',
          'confirmed',
          '--verbose',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /Bond.*was minted successfully/,
    })

    const [bondMint] = bondMintAddress(
      bondAccount,
      validatorIdentity.publicKey,
      program.programId,
    )
    const validatorIdentityBondAta = getAssociatedTokenAddressSync(
      bondMint,
      validatorIdentity.publicKey,
      true,
    )
    const tokenAccountValidatorIdentity = await getTokenAccount(
      provider.connection,
      validatorIdentityBondAta,
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
      true,
    )
    const createTokenIx = createAssociatedTokenAccountInstruction(
      provider.wallet.publicKey,
      userTokenBondAta,
      pubkey(user),
      bondMint,
    )
    const transferIx = createTransferInstruction(
      validatorIdentityBondAta,
      userTokenBondAta,
      pubkey(validatorIdentity),
      1,
    )
    await provider.sendIx([validatorIdentity], createTokenIx, transferIx)

    const newBondAuthority = PublicKey.unique()
    await (
      expect([
        'pnpm',
        [
          'cli:institutional',
          '-u',
          provider.connection.rpcEndpoint,
          'configure-bond',
          voteAccount.toBase58(),
          '--authority',
          userPath,
          '--bond-authority',
          newBondAuthority.toBase58(),
          '--with-token',
          '--confirmation-finality',
          'confirmed',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /Bond account.*successfully configured/,
    })

    const bondsData = await getBond(program, bondAccount)
    expect(bondsData.authority).toEqual(newBondAuthority)
  })
})
