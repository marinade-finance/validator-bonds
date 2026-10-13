import assert from 'assert'

import { extendJestWithShellMatchers } from '@marinade.finance/jest-shell-matcher'
import {
  bondsWithdrawerAuthority,
  findStakeAccounts,
} from '@marinade.finance/validator-bonds-sdk'
import { initTest } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testValidator'
import {
  createBondsFundedStakeAccount,
  createVoteAccount,
} from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/staking'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/testTransactions'
import {
  createTempFileKeypair,
  createUserAndFund,
} from '@marinade.finance/web3js-1x'
import { LAMPORTS_PER_SOL, SystemProgram } from '@solana/web3.js'

import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import type { ValidatorBondsProgram } from '@marinade.finance/validator-bonds-sdk'
import type { Keypair, PublicKey } from '@solana/web3.js'

describe('Refund bond balance using CLI', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
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
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
      epochsToClaimSettlement: 1,
      withdrawLockupEpochs: 2,
    }))
    assert((await provider.connection.getAccountInfo(configAccount)) != null)
    const { voteAccount: voteAccountAddress, validatorIdentity } =
      await createVoteAccount({ provider })
    voteAccount = voteAccountAddress
    ;({ bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount,
      validatorIdentity,
      cpmpe: 1,
    }))
  })

  afterEach(async () => {
    await fromCleanup()
  })

  async function transferToBond(lamports: number) {
    const transferIx = SystemProgram.transfer({
      fromPubkey: provider.walletPubkey,
      toPubkey: bondAccount,
      lamports,
    })
    await provider.sendIx([], transferIx)
  }

  async function bondRentExempt(): Promise<number> {
    const bondInfo = await provider.connection.getAccountInfo(bondAccount)
    assert(bondInfo != null)
    return await provider.connection.getMinimumBalanceForRentExemption(
      bondInfo.data.length,
    )
  }

  it('refund bond balance', async () => {
    const baseLamports = LAMPORTS_PER_SOL * 22
    const fundBondSols = 5
    const excessLamports = 1.5 * LAMPORTS_PER_SOL
    await createUserAndFund({
      provider,
      user: fromKeypair.publicKey,
      lamports: baseLamports,
    })
    await expect([
      'pnpm',
      [
        'cli',
        '-u',
        provider.connection.rpcEndpoint,
        '--program-id',
        program.programId.toBase58(),
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

    await transferToBond(excessLamports)
    const rentExempt = await bondRentExempt()
    expect(
      (await provider.connection.getAccountInfo(bondAccount))?.lamports,
    ).toEqual(rentExempt + excessLamports)

    await expect([
      'pnpm',
      [
        'cli',
        '-u',
        provider.connection.rpcEndpoint,
        '--program-id',
        program.programId.toBase58(),
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
    const [bondWithdrawer] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
    )
    const stakeAccounts = (
      await findStakeAccounts({
        connection: provider,
        staker: bondWithdrawer,
      })
    ).filter(
      s =>
        s.account.data.voter !== null &&
        s.account.data.voter.equals(voteAccount),
    )
    expect(stakeAccounts.length).toEqual(1)
    expect(stakeAccounts[0]?.account.lamports).toEqual(
      fundBondSols * LAMPORTS_PER_SOL + excessLamports,
    )
  })

  it('refund bond balance to explicit stake account', async () => {
    const smallerStakeLamports = 2 * LAMPORTS_PER_SOL
    const biggerStakeLamports = 4 * LAMPORTS_PER_SOL
    const excessLamports = LAMPORTS_PER_SOL
    await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      lamports: smallerStakeLamports,
      voteAccount,
    })
    const biggerStakeAccount = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      lamports: biggerStakeLamports,
      voteAccount,
    })
    await transferToBond(excessLamports)

    await expect([
      'pnpm',
      [
        'cli',
        '-u',
        provider.connection.rpcEndpoint,
        '--program-id',
        program.programId.toBase58(),
        'refund-bond-balance',
        bondAccount.toBase58(),
        '--stake-account',
        biggerStakeAccount.toBase58(),
        '--verbose',
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      stdout: /successfully refunded to stake account/,
    })

    expect(
      (await provider.connection.getAccountInfo(bondAccount))?.lamports,
    ).toEqual(await bondRentExempt())
    expect(
      (await provider.connection.getAccountInfo(biggerStakeAccount))?.lamports,
    ).toEqual(biggerStakeLamports + excessLamports)
  })

  it('fail to refund when no bond-funded stake account exists', async () => {
    await transferToBond(LAMPORTS_PER_SOL)
    await expect([
      'pnpm',
      [
        'cli',
        '-u',
        provider.connection.rpcEndpoint,
        '--program-id',
        program.programId.toBase58(),
        'refund-bond-balance',
        bondAccount.toBase58(),
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 200,
      stdout: /No bond-funded stake account found/,
    })
  })

  it('fail to refund when no excess lamports', async () => {
    await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      lamports: 2 * LAMPORTS_PER_SOL,
      voteAccount,
    })
    await expect([
      'pnpm',
      [
        'cli',
        '-u',
        provider.connection.rpcEndpoint,
        '--program-id',
        program.programId.toBase58(),
        'refund-bond-balance',
        bondAccount.toBase58(),
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 200,
      stdout: /no lamports above the rent-exempt minimum/,
    })
  })
})
