import { createTempFileKeypair } from '@marinade.finance/web3js-common'
import { shellMatchers } from '@marinade.finance/jest-utils'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  getStakeAccount,
  bondsWithdrawerAuthority,
} from '@marinade.finance/validator-bonds-sdk'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testTransactions'
import {
  AnchorExtendedProvider,
  initTest,
  waitForStakeAccountActivation,
} from '@marinade.finance/validator-bonds-sdk/__tests__/test-validator/testValidator'
import {
  createVoteAccount,
  delegatedStakeAccount,
} from '@marinade.finance/validator-bonds-sdk/__tests__/utils/staking'

describe('Init withdraw request using CLI', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let bondAccount: PublicKey
  let voteAccount: PublicKey
  let stakeWithdrawerPath: string
  let stakeWithdrawerKeypair: Keypair
  let stakeWithdrawerCleanup: () => Promise<void>

  beforeAll(async () => {
    shellMatchers()
    ;({ provider, program } = await initTest())
  })

  beforeEach(async () => {
    ;({
      path: stakeWithdrawerPath,
      keypair: stakeWithdrawerKeypair,
      cleanup: stakeWithdrawerCleanup,
    } = await createTempFileKeypair())
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
      epochsToClaimSettlement: 1,
      withdrawLockupEpochs: 2,
    }))
    expect(
      provider.connection.getAccountInfo(configAccount)
    ).resolves.not.toBeNull()
    const { voteAccount: voteAccountAddress, validatorIdentity } =
      await createVoteAccount({ provider })
    voteAccount = voteAccountAddress
    ;({ bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount,
      validatorIdentity,
      cpmpe: 123,
    }))
  })

  afterEach(async () => {
    await stakeWithdrawerCleanup()
  })

  it('init withdraw request', async () => {
    const [bondWithdrawer] = bondsWithdrawerAuthority(
      configAccount,
      program.programId
    )

    const { stakeAccount: stakeAccount1 } = await delegatedStakeAccount({
      provider,
      lamports: LAMPORTS_PER_SOL * 2,
      voteAccountToDelegate: voteAccount,
      withdrawer: stakeWithdrawerKeypair,
    })
    const { stakeAccount: stakeAccount2 } = await delegatedStakeAccount({
      provider,
      lamports: LAMPORTS_PER_SOL * 88,
      voteAccountToDelegate: voteAccount,
      withdrawer: stakeWithdrawerKeypair,
    })

    const stakeAccountData1Before = await getStakeAccount(
      provider,
      stakeAccount1
    )
    expect(stakeAccountData1Before.withdrawer).toEqual(
      stakeWithdrawerKeypair.publicKey
    )

    console.debug(
      `Waiting for stake account ${stakeAccount1.toBase58()} to be fully activated`
    )
    await waitForStakeAccountActivation({
      stakeAccount: stakeAccount1,
      connection: provider.connection,
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
          'fund-bond',
          bondAccount.toBase58(),
          '--stake-account',
          stakeAccount1.toBase58(),
          '--stake-authority',
          stakeWithdrawerPath,
          '--confirmation-finality',
          'confirmed',
          '--verbose',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /successfully funded/,
    })

    const stakeAccountData1 = await getStakeAccount(provider, stakeAccount1)
    expect(stakeAccountData1.staker).toEqual(bondWithdrawer)
    expect(stakeAccountData1.withdrawer).toEqual(bondWithdrawer)

    await waitForStakeAccountActivation({
      stakeAccount: stakeAccount2,
      connection: provider.connection,
    })
    await (
      expect([
        'pnpm',
        [
          'cli',
          'fund-bond',
          '-u',
          provider.connection.rpcEndpoint,
          '--program-id',
          program.programId.toBase58(),
          '--config',
          configAccount.toBase58(),
          '--stake-account',
          stakeAccount2.toBase58(),
          '--vote-account',
          voteAccount.toBase58(),
          '--stake-authority',
          stakeWithdrawerPath,
          '--confirmation-finality',
          'confirmed',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /successfully funded/,
    })

    const stakeAccountData2 = await getStakeAccount(provider, stakeAccount2)
    expect(stakeAccountData2.staker).toEqual(bondWithdrawer)
    expect(stakeAccountData2.withdrawer).toEqual(bondWithdrawer)
  })

  it('fund bond in print-only mode', async () => {
    const { stakeAccount, staker, withdrawer } = await delegatedStakeAccount({
      provider,
      lamports: LAMPORTS_PER_SOL * 88,
      voteAccountToDelegate: voteAccount,
      withdrawer: stakeWithdrawerKeypair,
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
          'fund-bond',
          bondAccount.toBase58(),
          '--stake-account',
          stakeAccount.toBase58(),
          '--stake-authority',
          stakeWithdrawerPath,
          '--print-only',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /successfully funded/,
    })

    const stakeAccountData = await getStakeAccount(provider, stakeAccount)
    expect(stakeAccountData.staker).toEqual(staker.publicKey)
    expect(stakeAccountData.withdrawer).toEqual(withdrawer.publicKey)
  })
})
