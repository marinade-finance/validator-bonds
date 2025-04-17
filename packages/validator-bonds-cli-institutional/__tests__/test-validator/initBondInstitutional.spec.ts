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
  MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
  ValidatorBondsProgram,
  bondAddress,
  getBond,
} from '@marinade.finance/validator-bonds-sdk'
import { initTest } from '../../../validator-bonds-sdk/__tests__/test-validator/testValidator'
import { createVoteAccountWithIdentity } from '../../../validator-bonds-sdk/__tests__/utils/staking'
import {
  AnchorExtendedProvider,
  getAnchorValidatorInfo,
} from '@marinade.finance/anchor-common'

describe('CLI init bond account (institutional)', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let rentPayerPath: string
  let rentPayerKeypair: Keypair
  let rentPayerCleanup: () => Promise<void>
  const rentPayerFunds = 10 * LAMPORTS_PER_SOL
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
    expect(
      await provider.connection.getAccountInfo(
        MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
      ),
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
    await expect(
      await provider.connection.getBalance(rentPayerKeypair.publicKey),
    ).toStrictEqual(rentPayerFunds)
  })

  afterEach(async () => {
    await rentPayerCleanup()
  })

  it('init bond account (institutional)', async () => {
    const bondAuthority = Keypair.generate()
    await (
      expect([
        'pnpm',
        [
          'cli:institutional',
          '-u',
          provider.connection.rpcEndpoint,
          'init-bond',
          '--vote-account',
          voteAccount.toBase58(),
          '--validator-identity',
          validatorIdentityPath,
          '--bond-authority',
          bondAuthority.publicKey.toBase58(),
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
      MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
      voteAccount,
      program.programId,
    )
    const bondsData = await getBond(program, bondAccount)
    expect(bondsData.config).toEqual(MARINADE_INSTITUTIONAL_CONFIG_ADDRESS)
    expect(bondsData.voteAccount).toEqual(voteAccount)
    expect(bondsData.authority).toEqual(bondAuthority.publicKey)
    expect(bondsData.bump).toEqual(bump)
    await expect(
      await provider.connection.getBalance(rentPayerKeypair.publicKey),
    ).toBeLessThan(rentPayerFunds)
  })
})
