import assert from 'assert'

import {
  U64_MAX,
  executeTxSimple,
  transaction,
  waitForNextEpoch,
} from '@marinade.finance/web3js-1x'
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js'

import {
  RESET_STAKE_EVENT,
  getStakeAccount,
  resetStakeInstruction,
  settlementStakerAuthority,
  bondsWithdrawerAuthority,
  parseCpiEvents,
  assertEvent,
} from '../../src'
import {
  createSettlementFundedDelegatedStake,
  createVoteAccount,
} from '../utils/staking'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '../utils/testTransactions'
import { initTest } from '../utils/testValidator'

import type { ValidatorBondsProgram } from '../../src'
import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import type { PublicKey } from '@solana/web3.js'

describe('Validator Bonds reset settlement stake account', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let voteAccount: PublicKey
  let bondAccount: PublicKey

  beforeAll(() => {
    ;({ provider, program } = initTest())
  })

  beforeEach(async () => {
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
    }))
    const { voteAccount: validatorVoteAccount, validatorIdentity } =
      await createVoteAccount({ provider })
    voteAccount = validatorVoteAccount
    ;({ bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount: configAccount,
      voteAccount,
      validatorIdentity,
    }))
  })

  it('reset stake', async () => {
    // https://github.com/solana-labs/solana/blob/v1.18.11/sdk/program/src/stake/instruction.rs#L23
    // 0x3 = TooSoonToRedelegate,
    await waitForNextEpoch(provider.connection, 15)

    const fakeSettlement = Keypair.generate().publicKey
    const stakeAccount = await createSettlementFundedDelegatedStake({
      program,
      provider,
      configAccount: configAccount,
      settlementAccount: fakeSettlement,
      voteAccount,
      lamports: LAMPORTS_PER_SOL * 54,
    })

    const [bondWithdrawer] = bondsWithdrawerAuthority(
      configAccount,
      program.programId
    )
    const [settlementAuth] = settlementStakerAuthority(
      fakeSettlement,
      program.programId
    )

    let stakeAccountData = await getStakeAccount(provider, stakeAccount)
    expect(stakeAccountData.staker).toEqual(settlementAuth)
    expect(stakeAccountData.withdrawer).toEqual(bondWithdrawer)

    const tx = await transaction(provider)

    const { instruction } = await resetStakeInstruction({
      program,
      configAccount,
      stakeAccount,
      voteAccount,
      settlementAccount: fakeSettlement,
    })
    tx.add(instruction)

    const executionReturn = await executeTxSimple(provider.connection, tx, [
      provider.wallet,
    ])

    stakeAccountData = await getStakeAccount(provider, stakeAccount)
    expect(stakeAccountData.staker).toEqual(bondWithdrawer)
    expect(stakeAccountData.withdrawer).toEqual(bondWithdrawer)
    expect(stakeAccountData.voter).toEqual(voteAccount)
    expect(stakeAccountData.deactivationEpoch).toEqual(U64_MAX)
    expect(stakeAccountData.activationEpoch).toEqual(
      (await provider.connection.getEpochInfo()).epoch
    )
    expect(stakeAccountData.isCoolingDown).toEqual(false)
    expect(stakeAccountData.isLockedUp).toBeFalsy()

    const events = parseCpiEvents(program, executionReturn?.response)
    const e = assertEvent(events, RESET_STAKE_EVENT)
    assert(e !== undefined)
    expect(e.bond).toEqual(bondAccount)
    expect(e.stakeAccount).toEqual(stakeAccount)
    expect(e.config).toEqual(configAccount)
    expect(e.settlement).toEqual(fakeSettlement)
    expect(e.settlementStakerAuthority).toEqual(settlementAuth)
    expect(e.voteAccount).toEqual(voteAccount)
  })
})
