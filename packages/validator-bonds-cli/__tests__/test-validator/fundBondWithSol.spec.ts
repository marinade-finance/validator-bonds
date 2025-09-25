import {
  createTempFileKeypair,
  createUserAndFund,
  getStakeAccount,
} from '@marinade.finance/web3js-1x'
import { extendJestWithShellMatchers } from '@marinade.finance/jest-shell-matcher'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  bondsWithdrawerAuthority,
  findStakeAccounts,
  getBond,
  getRentExemptStake,
} from '@marinade.finance/validator-bonds-sdk'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testTransactions'
import { initTest } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testValidator'
import { createVoteAccount } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/staking'
import { AnchorExtendedProvider } from '@marinade.finance/anchor-common'

describe('Fund bond account with SOL using CLI', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let bondAccount: PublicKey
  let voteAccount: PublicKey
  let fromKeypair: Keypair
  let fromPath: string
  let fromCleanup: () => Promise<void>

  beforeAll(async () => {
    extendJestWithShellMatchers()
    ;({ provider, program } = await initTest())
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
    expect(
      await provider.connection.getAccountInfo(configAccount),
    ).not.toBeNull()
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

  it('fund bond account with sol', async () => {
    const baseLamports = LAMPORTS_PER_SOL * 22
    const fundBondSols = 5
    await createUserAndFund({
      provider,
      user: fromKeypair.publicKey,
      lamports: baseLamports,
    })
    await (
      expect([
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      stdout: /successfully funded with amount/,
    })
    const userAccount = await provider.connection.getAccountInfo(
      fromKeypair.publicKey,
    )
    expect(userAccount?.lamports).toEqual(
      baseLamports - fundBondSols * LAMPORTS_PER_SOL,
    )

    const [bondWithdrawer] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
    )
    const stakeAccounts = await findStakeAccounts({
      connection: provider,
      staker: bondWithdrawer,
    })
    expect(stakeAccounts.length).toEqual(1)
    const stakeAccount = await getStakeAccount(
      provider,
      stakeAccounts[0]?.publicKey || PublicKey.default,
    )
    expect(stakeAccount.balanceLamports).toEqual(
      fundBondSols * LAMPORTS_PER_SOL,
    )
    expect(stakeAccount.stakedLamports).toEqual(
      fundBondSols * LAMPORTS_PER_SOL - (await getRentExemptStake(provider)),
    )
    const bondAccountData = await getBond(program, bondAccount)
    expect(stakeAccount.voter).toEqual(bondAccountData.voteAccount)
    expect(stakeAccount.staker).toEqual(bondWithdrawer)
    expect(stakeAccount.withdrawer).toEqual(bondWithdrawer)
    expect(stakeAccount.activationEpoch).toEqual(
      (await provider.connection.getEpochInfo()).epoch,
    )

    const fundBondSolsSecond = 2.22
    await (
      expect([
        'pnpm',
        [
          'cli',
          '-u',
          provider.connection.rpcEndpoint,
          '--program-id',
          program.programId.toBase58(),
          'fund-bond-sol',
          bondAccountData.voteAccount.toBase58(),
          '--config',
          configAccount.toBase58(),
          '--amount',
          fundBondSolsSecond,
          '--from',
          fromPath,
          '--verbose',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      stdout: /successfully funded with amount/,
    })

    const userAccountAfter = await provider.connection.getAccountInfo(
      fromKeypair.publicKey,
    )
    expect(userAccountAfter?.lamports).toEqual(
      baseLamports - (fundBondSols + fundBondSolsSecond) * LAMPORTS_PER_SOL,
    )
    const stakeAccountsSecond = await findStakeAccounts({
      connection: provider,
      staker: bondWithdrawer,
    })
    expect(stakeAccountsSecond.length).toEqual(2)
  })
})
