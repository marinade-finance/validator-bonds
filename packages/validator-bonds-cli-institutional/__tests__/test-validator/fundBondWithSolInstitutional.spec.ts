import assert from 'assert'

import { extendJestWithShellMatchers } from '@marinade.finance/jest-shell-matcher'
import {
  MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
  bondsWithdrawerAuthority,
  findStakeAccounts,
  getBond,
  getRentExemptStake,
} from '@marinade.finance/validator-bonds-sdk'
import { initTest } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testValidator'
import { createVoteAccount } from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/staking'
import { executeInitBondInstruction } from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/testTransactions'
import {
  createTempFileKeypair,
  createUserAndFund,
  getStakeAccount,
} from '@marinade.finance/web3js-1x'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'

import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import type { ValidatorBondsProgram } from '@marinade.finance/validator-bonds-sdk'
import type { Keypair } from '@solana/web3.js'

describe('Fund bond account with SOL using CLI (institutional)', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let bondAccount: PublicKey
  let voteAccount: PublicKey
  let fromKeypair: Keypair
  let fromPath: string
  let fromCleanup: () => Promise<void>

  beforeAll(() => {
    extendJestWithShellMatchers()
    ;({ provider, program } = initTest())
  })

  beforeEach(async () => {
    ;({
      path: fromPath,
      keypair: fromKeypair,
      cleanup: fromCleanup,
    } = await createTempFileKeypair())
    assert(
      (await provider.connection.getAccountInfo(
        MARINADE_INSTITUTIONAL_CONFIG_ADDRESS
      )) !== null
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

  afterEach(async () => {
    await fromCleanup()
  })

  it('fund bond account with sol (institutional)', async () => {
    const baseLamports = LAMPORTS_PER_SOL * 22
    const fundBondSols = 5
    await createUserAndFund({
      provider,
      user: fromKeypair.publicKey,
      lamports: baseLamports,
    })
    await expect([
      'pnpm',
      [
        'cli:institutional',
        '-u',
        provider.connection.rpcEndpoint,
        'fund-bond-sol',
        bondAccount.toBase58(),
        '--amount',
        fundBondSols,
        '--from',
        fromPath,
        '--verbose',
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      stdout: /successfully funded with amount/,
    })

    const userAccount = await provider.connection.getAccountInfo(
      fromKeypair.publicKey
    )
    expect(userAccount?.lamports).toEqual(
      baseLamports - fundBondSols * LAMPORTS_PER_SOL
    )
    const [bondWithdrawer] = bondsWithdrawerAuthority(
      MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
      program.programId
    )
    const stakeAccounts = (
      await findStakeAccounts({
        connection: provider,
        staker: bondWithdrawer,
      })
    ).filter(
      s =>
        s.account.data.voter !== null &&
        s.account.data.voter.equals(voteAccount)
    )
    expect(stakeAccounts.length).toEqual(1)
    const stakeAccount = await getStakeAccount(
      provider,
      stakeAccounts[0]?.publicKey || PublicKey.default
    )
    expect(stakeAccount.balanceLamports).toEqual(
      fundBondSols * LAMPORTS_PER_SOL
    )
    expect(stakeAccount.stakedLamports).toEqual(
      fundBondSols * LAMPORTS_PER_SOL - (await getRentExemptStake(provider))
    )
    const bondAccountData = await getBond(program, bondAccount)
    expect(stakeAccount.voter).toEqual(bondAccountData.voteAccount)
    expect(stakeAccount.staker).toEqual(bondWithdrawer)
    expect(stakeAccount.withdrawer).toEqual(bondWithdrawer)
    expect(stakeAccount.activationEpoch).toEqual(
      (await provider.connection.getEpochInfo()).epoch
    )
  })
})
