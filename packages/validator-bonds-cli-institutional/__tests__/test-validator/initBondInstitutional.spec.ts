import assert from 'assert'

import { getAnchorValidatorInfo } from '@marinade.finance/anchor-common'
import { extendJestWithShellMatchers } from '@marinade.finance/jest-shell-matcher'
import {
  MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
  bondAddress,
  getBond,
} from '@marinade.finance/validator-bonds-sdk'
import { initTest } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testValidator'
import { createVoteAccountWithIdentity } from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/staking'
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
    assert(
      (await provider.connection.getAccountInfo(
        MARINADE_INSTITUTIONAL_CONFIG_ADDRESS
      )) !== null
    )
    ;({ validatorIdentity, validatorIdentityPath } =
      await getAnchorValidatorInfo(provider.connection))
    ;({ voteAccount } = await createVoteAccountWithIdentity(
      provider,
      validatorIdentity
    ))

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: rentPayerKeypair.publicKey,
        lamports: rentPayerFunds,
      })
    )
    await provider.sendAndConfirm(tx)
    assert(
      (await provider.connection.getBalance(rentPayerKeypair.publicKey)) ===
        rentPayerFunds
    )
  })

  afterEach(async () => {
    await rentPayerCleanup()
  })

  it('init bond account (institutional)', async () => {
    const bondAuthority = Keypair.generate()
    await expect([
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
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /Bond account .* successfully created/,
    })

    const [bondAccount, bump] = bondAddress(
      MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
      voteAccount,
      program.programId
    )
    const bondsData = await getBond(program, bondAccount)
    expect(bondsData.config).toEqual(MARINADE_INSTITUTIONAL_CONFIG_ADDRESS)
    expect(bondsData.voteAccount).toEqual(voteAccount)
    expect(bondsData.authority).toEqual(bondAuthority.publicKey)
    expect(bondsData.bump).toEqual(bump)
    expect(
      await provider.connection.getBalance(rentPayerKeypair.publicKey)
    ).toBeLessThan(rentPayerFunds)
  })
})
