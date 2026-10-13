import assert from 'assert'

import { extendJestWithShellMatchers } from '@marinade.finance/jest-shell-matcher'
import { MARINADE_INSTITUTIONAL_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'
import { initTest } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testValidator'
import {
  createBondsFundedStakeAccount,
  createVoteAccount,
} from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/staking'
import { executeInitBondInstruction } from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/testTransactions'
import { LAMPORTS_PER_SOL, SystemProgram } from '@solana/web3.js'

import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import type { ValidatorBondsProgram } from '@marinade.finance/validator-bonds-sdk'
import type { PublicKey } from '@solana/web3.js'

describe('Refund bond balance using CLI (institutional)', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let bondAccount: PublicKey
  let voteAccount: PublicKey

  beforeAll(() => {
    extendJestWithShellMatchers()
    ;({ provider, program } = initTest())
  })

  beforeEach(async () => {
    assert(
      (await provider.connection.getAccountInfo(
        MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
      )) !== null,
    )
    const { voteAccount: voteAccountAddress, validatorIdentity } =
      await createVoteAccount({ provider })
    voteAccount = voteAccountAddress
    ;({ bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
      voteAccount,
      validatorIdentity,
      cpmpe: 1,
    }))
  })

  it('refund bond balance (institutional)', async () => {
    const stakeLamports = 2 * LAMPORTS_PER_SOL
    const excessLamports = 1.5 * LAMPORTS_PER_SOL
    const stakeAccount = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
      lamports: stakeLamports,
      voteAccount,
    })
    const transferIx = SystemProgram.transfer({
      fromPubkey: provider.walletPubkey,
      toPubkey: bondAccount,
      lamports: excessLamports,
    })
    await provider.sendIx([], transferIx)

    const bondInfo = await provider.connection.getAccountInfo(bondAccount)
    assert(bondInfo != null)
    const rentExempt =
      await provider.connection.getMinimumBalanceForRentExemption(
        bondInfo.data.length,
      )

    await expect([
      'pnpm',
      [
        'cli:institutional',
        '-u',
        provider.connection.rpcEndpoint,
        'refund-bond-balance',
        bondAccount.toBase58(),
        '--verbose',
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      stdout: /successfully refunded to stake account/,
    })

    expect(
      (await provider.connection.getAccountInfo(bondAccount))?.lamports,
    ).toEqual(rentExempt)
    expect(
      (await provider.connection.getAccountInfo(stakeAccount))?.lamports,
    ).toEqual(stakeLamports + excessLamports)
  })
})
