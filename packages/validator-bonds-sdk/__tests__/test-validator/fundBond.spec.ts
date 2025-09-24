import assert from 'assert'

import { waitForStakeAccountActivation } from '@marinade.finance/anchor-common'
import { executeTxSimple, transaction } from '@marinade.finance/web3js-1x'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'

import {
  FUND_BOND_EVENT,
  fundBondInstruction,
  getStakeAccount,
  bondsWithdrawerAuthority,
  parseCpiEvents,
  assertEvent,
} from '../../src'
import { createVoteAccount, delegatedStakeAccount } from '../utils/staking'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '../utils/testTransactions'
import { initTest } from '../utils/testValidator'

import type { ValidatorBondsProgram } from '../../src'
import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import type { PublicKey } from '@solana/web3.js'

describe('Validator Bonds fund bond', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let bondAccount: PublicKey
  let voteAccount: PublicKey

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
      configAccount,
      voteAccount,
      validatorIdentity,
    }))
  })

  it('fund bond', async () => {
    const { stakeAccount, withdrawer } = await delegatedStakeAccount({
      provider,
      lamports: LAMPORTS_PER_SOL * 2,
      voteAccountToDelegate: voteAccount,
    })
    console.debug(
      `Waiting for activation of stake account: ${stakeAccount.toBase58()}`
    )
    await waitForStakeAccountActivation({
      stakeAccount,
      connection: provider.connection,
      timeoutSeconds: 60,
    })

    const tx = await transaction(provider)

    const { instruction } = await fundBondInstruction({
      program,
      bondAccount,
      configAccount,
      stakeAccount,
      stakeAccountAuthority: withdrawer,
    })
    tx.add(instruction)
    const executionReturn = await executeTxSimple(provider.connection, tx, [
      provider.wallet,
      withdrawer,
    ])

    const stakeAccountData = await getStakeAccount(provider, stakeAccount)
    const [bondWithdrawer] = bondsWithdrawerAuthority(
      configAccount,
      program.programId
    )
    expect(stakeAccountData.staker).toEqual(bondWithdrawer)
    expect(stakeAccountData.withdrawer).toEqual(bondWithdrawer)
    expect(stakeAccountData.isLockedUp).toBeFalsy()

    const events = parseCpiEvents(program, executionReturn?.response)
    const e = assertEvent(events, FUND_BOND_EVENT)
    // Ensure the event was emitted
    assert(e !== undefined)
    expect(e.bond).toEqual(bondAccount)
    expect(e.depositedAmount).toEqual(2 * LAMPORTS_PER_SOL)
    expect(e.stakeAccount).toEqual(stakeAccount)
    expect(e.stakeAuthoritySigner).toEqual(withdrawer.publicKey)
    expect(e.voteAccount).toEqual(voteAccount)
  })
})
