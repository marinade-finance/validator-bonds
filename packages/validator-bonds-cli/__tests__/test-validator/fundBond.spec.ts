import assert from 'assert'

import { waitForStakeAccountActivation } from '@marinade.finance/anchor-common'
import { extendJestWithShellMatchers } from '@marinade.finance/jest-shell-matcher'
import {
  getStakeAccount,
  bondsWithdrawerAuthority,
} from '@marinade.finance/validator-bonds-sdk'
import { initTest } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testValidator'
import {
  createVoteAccount,
  delegatedStakeAccount,
} from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/staking'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/testTransactions'
import { createTempFileKeypair } from '@marinade.finance/web3js-1x'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'

import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import type { ValidatorBondsProgram } from '@marinade.finance/validator-bonds-sdk'
import type { Keypair, PublicKey } from '@solana/web3.js'

describe('Fund bond account using CLI', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let bondAccount: PublicKey
  let voteAccount: PublicKey
  let stakeWithdrawerPath: string
  let stakeWithdrawerKeypair: Keypair
  let stakeWithdrawerCleanup: () => Promise<void>

  beforeAll(() => {
    extendJestWithShellMatchers()
    ;({ provider, program } = initTest())
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
      cpmpe: 123,
    }))
  })

  afterEach(async () => {
    await stakeWithdrawerCleanup()
  })

  it('fund bond account', async () => {
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
    await expect([
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
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /successfully funded/,
    })

    const stakeAccountData1 = await getStakeAccount(provider, stakeAccount1)
    expect(stakeAccountData1.staker).toEqual(bondWithdrawer)
    expect(stakeAccountData1.withdrawer).toEqual(bondWithdrawer)

    await expect([
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
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /is ALREADY funded to bond account/,
    })

    await waitForStakeAccountActivation({
      stakeAccount: stakeAccount2,
      connection: provider.connection,
    })
    await expect([
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
        voteAccount.toBase58(),
        '--stake-account',
        stakeAccount2.toBase58(),
        '--stake-authority',
        stakeWithdrawerPath,
        '--confirmation-finality',
        'confirmed',
      ],
    ]).toHaveMatchingSpawnOutput({
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

    await expect([
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
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /successfully funded/,
    })

    const stakeAccountData = await getStakeAccount(provider, stakeAccount)
    expect(stakeAccountData.staker).toEqual(staker.publicKey)
    expect(stakeAccountData.withdrawer).toEqual(withdrawer.publicKey)
  })
})
