import assert from 'assert'

import { extendJestWithShellMatchers } from '@marinade.finance/jest-shell-matcher'
import { rand } from '@marinade.finance/ts-common'
import {
  MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
  getWithdrawRequest,
} from '@marinade.finance/validator-bonds-sdk'
import { initTest } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testValidator'
import { createVoteAccount } from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/staking'
import {
  executeInitBondInstruction,
  executeInitWithdrawRequestInstruction,
} from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/testTransactions'
import {
  createTempFileKeypair,
  createUserAndFund,
  pubkey,
} from '@marinade.finance/web3js-1x'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'

import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import type { ValidatorBondsProgram } from '@marinade.finance/validator-bonds-sdk'
import type { Keypair, PublicKey } from '@solana/web3.js'

describe('Cancel withdraw request using CLI (institutional)', () => {
  let stakeAccountLamports: number
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let bondAccount: PublicKey
  let voteAccount: PublicKey
  let withdrawRequestAccount: PublicKey
  let validatorIdentityPath: string
  let validatorIdentityKeypair: Keypair
  let validatorIdentityCleanup: () => Promise<void>

  beforeAll(() => {
    extendJestWithShellMatchers()
    ;({ provider, program } = initTest())
  })

  beforeEach(async () => {
    ;({
      path: validatorIdentityPath,
      keypair: validatorIdentityKeypair,
      cleanup: validatorIdentityCleanup,
    } = await createTempFileKeypair())
    stakeAccountLamports = LAMPORTS_PER_SOL * rand(99, 5)
    assert(
      (await provider.connection.getAccountInfo(
        MARINADE_INSTITUTIONAL_CONFIG_ADDRESS
      )) !== null
    )
    ;({ voteAccount } = await createVoteAccount({
      provider,
      validatorIdentity: validatorIdentityKeypair,
    }))
    ;({ bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
      voteAccount,
    }))
    ;({ withdrawRequestAccount } = await executeInitWithdrawRequestInstruction({
      program,
      provider,
      configAccount: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
      bondAccount,
      validatorIdentity: validatorIdentityKeypair,
      amount: stakeAccountLamports,
    }))
  })

  afterEach(async () => {
    await validatorIdentityCleanup()
  })

  it('cancel withdraw request', async () => {
    const withdrawRequestData = await getWithdrawRequest(
      program,
      withdrawRequestAccount
    )
    expect(withdrawRequestData.requestedAmount).toEqual(stakeAccountLamports)
    const rentExempt = (
      await provider.connection.getAccountInfo(withdrawRequestAccount)
    )?.lamports
    const userFunding = LAMPORTS_PER_SOL
    const user = await createUserAndFund({ provider, lamports: userFunding })
    expect(await provider.connection.getAccountInfo(voteAccount)).not.toBeNull()

    await expect([
      'pnpm',
      [
        'cli:institutional',
        '-u',
        provider.connection.rpcEndpoint,
        'cancel-withdraw-request',
        voteAccount.toBase58(),
        '--authority',
        validatorIdentityPath,
        '--rent-collector',
        pubkey(user).toBase58(),
        '--confirmation-finality',
        'confirmed',
        '--verbose',
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /successfully cancelled/,
    })

    expect(
      await provider.connection.getAccountInfo(withdrawRequestAccount)
    ).toBeNull()
    expect(
      (await provider.connection.getAccountInfo(pubkey(user)))?.lamports
    ).toEqual(userFunding + rentExempt!)
  })
})
