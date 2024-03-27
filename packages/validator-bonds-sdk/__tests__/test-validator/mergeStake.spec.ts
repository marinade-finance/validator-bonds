import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  MERGE_STAKE_EVENT,
  ValidatorBondsProgram,
  getStakeAccount,
  mergeStakeInstruction,
  bondsWithdrawerAuthority,
  parseCpiEvents,
  assertEvent,
} from '../../src'
import { initTest } from './testValidator'
import { executeInitConfigInstruction } from '../utils/testTransactions'
import {
  executeTxSimple,
  transaction,
  waitForNextEpoch,
} from '@marinade.finance/web3js-common'
import { authorizeStakeAccount, delegatedStakeAccount } from '../utils/staking'

import { assert } from 'console'
import { AnchorExtendedProvider } from '@marinade.finance/anchor-common'

describe('Validator Bonds fund bond', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey

  beforeAll(async () => {
    ;({ provider, program } = await initTest())
  })

  beforeEach(async () => {
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
    }))
  })

  it('merge stake', async () => {
    // we want to be at the beginning of the epoch
    // otherwise the merge instruction could fail as the stake account is in transient state (0xc)
    // https://github.com/solana-labs/solana/blob/v1.17.15/sdk/program/src/stake/instruction.rs#L39
    await waitForNextEpoch(provider.connection, 15)
    const [bondWithdrawer] = bondsWithdrawerAuthority(
      configAccount,
      program.programId
    )
    const [lamports1, lamports2] = [2, 3].map(n => n * LAMPORTS_PER_SOL)
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

    const tx = await transaction(provider)
    const { instruction } = await mergeStakeInstruction({
      program,
      configAccount,
      sourceStakeAccount: stakeAccount2,
      destinationStakeAccount: stakeAccount1,
    })
    tx.add(instruction)
    const executionReturn = await executeTxSimple(provider.connection, tx, [
      provider.wallet,
    ])

    const stakeAccountData = await getStakeAccount(provider, stakeAccount1)
    expect(stakeAccountData.staker).toEqual(bondWithdrawer)
    expect(stakeAccountData.withdrawer).toEqual(bondWithdrawer)
    expect(stakeAccountData.isLockedUp).toBeFalsy()
    expect(stakeAccountData.balanceLamports).toEqual(lamports1 + lamports2)
    expect(
      provider.connection.getAccountInfo(stakeAccount2)
    ).resolves.toBeNull()

    const events = parseCpiEvents(program, executionReturn?.response)
    const e = assertEvent(events, MERGE_STAKE_EVENT)
    assert(e !== undefined)
    expect(e.config).toEqual(configAccount)
    expect(e.destinationStake).toEqual(stakeAccount1)
    expect(e.destinationDelegation?.voterPubkey).toEqual(voteAccount)
    expect(e.sourceStake).toEqual(stakeAccount2)
    expect(e.sourceDelegation?.voterPubkey).toEqual(voteAccount)
    expect(e.stakerAuthority).toEqual(bondWithdrawer)
  })
})
