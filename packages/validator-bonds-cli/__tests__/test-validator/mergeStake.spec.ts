import assert from 'assert'

import { extendJestWithShellMatchers } from '@marinade.finance/jest-shell-matcher'
import { bondsWithdrawerAuthority } from '@marinade.finance/validator-bonds-sdk'
import { initTest } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testValidator'
import {
  authorizeStakeAccount,
  delegatedStakeAccount,
} from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/staking'
import { executeInitConfigInstruction } from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/testTransactions'
import { waitForNextEpoch } from '@marinade.finance/web3js-1x'
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js'

import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import type { ValidatorBondsProgram } from '@marinade.finance/validator-bonds-sdk'
import type { ExtendedProvider } from '@marinade.finance/web3js-1x'
import type { PublicKey } from '@solana/web3.js'

describe('Merge stake accounts using CLI', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey

  beforeAll(async () => {
    extendJestWithShellMatchers()
    ;({ provider, program } = initTest())
    // we want to be at the beginning of the epoch
    // otherwise the merge instruction could fail as the stake account is in different state (0x6)
    // https://github.com/solana-labs/solana/blob/v1.17.15/sdk/program/src/stake/instruction.rs#L42
    await waitForNextEpoch(provider.connection, 15)
  })

  beforeEach(async () => {
    const adminKeypair = Keypair.generate()
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
      adminAuthority: adminKeypair,
      epochsToClaimSettlement: 1,
      withdrawLockupEpochs: 2,
    }))
    assert((await provider.connection.getAccountInfo(configAccount)) != null)
  })

  it('merge stake accounts', async () => {
    const { stakeAccount1, stakeAccount2 } = await createMergeStakeAccounts({
      provider,
      programId: program.programId,
      configAccount,
      lamports1: LAMPORTS_PER_SOL * 2,
      lamports2: LAMPORTS_PER_SOL * 3,
    })

    await expect([
      'pnpm',
      [
        'cli',
        '-u',
        provider.connection.rpcEndpoint,
        '--program-id',
        program.programId.toBase58(),
        'merge-stake',
        '--source',
        stakeAccount1.toBase58(),
        '--destination',
        stakeAccount2.toBase58(),
        '--config',
        configAccount.toBase58(),
        '--confirmation-finality',
        'confirmed',
        '-v',
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /successfully merged/,
    })

    const stakeAccount1Info =
      await provider.connection.getAccountInfo(stakeAccount1)
    const stakeAccount2Info =
      await provider.connection.getAccountInfo(stakeAccount2)
    expect(stakeAccount1Info).toBeNull()
    expect(stakeAccount2Info).not.toBeNull()
    expect(stakeAccount2Info?.lamports).toEqual(LAMPORTS_PER_SOL * 5)
  })

  it('merge in print-only mode', async () => {
    const { stakeAccount1, stakeAccount2 } = await createMergeStakeAccounts({
      provider,
      programId: program.programId,
      configAccount,
    })

    await expect([
      'pnpm',
      [
        'cli',
        '-u',
        provider.connection.rpcEndpoint,
        '--program-id',
        program.programId.toBase58(),
        'merge-stake',
        '--source',
        stakeAccount1.toBase58(),
        '--destination',
        stakeAccount2.toBase58(),
        '--config',
        configAccount.toBase58(),
        '--print-only',
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /successfully merged/,
    })
    expect(
      await provider.connection.getAccountInfo(stakeAccount1),
    ).not.toBeNull()
    expect(
      await provider.connection.getAccountInfo(stakeAccount2),
    ).not.toBeNull()
  })
})

async function createMergeStakeAccounts({
  provider,
  configAccount,
  programId,
  lamports1 = LAMPORTS_PER_SOL * 2,
  lamports2 = LAMPORTS_PER_SOL * 2 + 1,
}: {
  provider: ExtendedProvider
  programId: PublicKey
  configAccount: PublicKey
  lamports1?: number
  lamports2?: number
}): Promise<{ stakeAccount1: PublicKey; stakeAccount2: PublicKey }> {
  const [bondWithdrawer] = bondsWithdrawerAuthority(configAccount, programId)
  const {
    stakeAccount: stakeAccount1,
    withdrawer: withdrawer1,
    voteAccount,
  } = await delegatedStakeAccount({
    provider,
    lamports: lamports1,
    lockup: undefined,
  })
  await authorizeStakeAccount({
    provider,
    authority: withdrawer1,
    stakeAccount: stakeAccount1,
    staker: bondWithdrawer,
    withdrawer: bondWithdrawer,
  })
  const { stakeAccount: stakeAccount2, withdrawer: withdrawer2 } =
    await delegatedStakeAccount({
      provider,
      lamports: lamports2,
      lockup: undefined,
      voteAccountToDelegate: voteAccount,
    })
  await authorizeStakeAccount({
    provider,
    authority: withdrawer2,
    stakeAccount: stakeAccount2,
    staker: bondWithdrawer,
    withdrawer: bondWithdrawer,
  })
  const stakeAccount1Info =
    await provider.connection.getAccountInfo(stakeAccount1)
  const stakeAccount2Info =
    await provider.connection.getAccountInfo(stakeAccount2)
  expect(stakeAccount1Info).not.toBeNull()
  expect(stakeAccount2Info).not.toBeNull()
  expect(stakeAccount1Info?.lamports).toEqual(lamports1)
  expect(stakeAccount2Info?.lamports).toEqual(lamports2)
  return { stakeAccount1, stakeAccount2 }
}
