import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  WITHDRAW_STAKE_EVENT,
  getStakeAccount,
  settlementStakerAuthority,
  withdrawStakeInstruction,
  bondsWithdrawerAuthority,
  parseCpiEvents,
  assertEvent,
} from '../../src'
import { initTest } from './testValidator'
import { executeInitConfigInstruction } from '../utils/testTransactions'
import { executeTxSimple, transaction } from '@marinade.finance/web3js-common'
import { createSettlementFundedInitializedStake } from '../utils/staking'
import { createUserAndFund, pubkey } from '@marinade.finance/web3js-common'
import assert from 'assert'
import { AnchorExtendedProvider } from '@marinade.finance/anchor-common'

describe('Validator Bonds withdraw settlement stake account', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let operatorAuthority: Keypair

  beforeAll(async () => {
    ;({ provider, program } = await initTest())
  })

  beforeEach(async () => {
    ;({ configAccount, operatorAuthority } = await executeInitConfigInstruction(
      {
        program,
        provider,
      }
    ))
  })

  it('withdraw stake', async () => {
    const fakeSettlement = Keypair.generate().publicKey
    const [bondWithdrawer] = bondsWithdrawerAuthority(
      configAccount,
      program.programId
    )
    const [settlementAuth] = settlementStakerAuthority(
      fakeSettlement,
      program.programId
    )

    const stakeAccount = await createSettlementFundedInitializedStake({
      program,
      provider,
      configAccount,
      settlementAccount: fakeSettlement,
      lamports: LAMPORTS_PER_SOL,
    })

    const stakeAccountData = await getStakeAccount(provider, stakeAccount)
    expect(stakeAccountData.staker).toEqual(settlementAuth)
    expect(stakeAccountData.withdrawer).toEqual(bondWithdrawer)

    const user = await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL,
    })

    const tx = await transaction(provider)

    const { instruction } = await withdrawStakeInstruction({
      program,
      configAccount,
      stakeAccount,
      settlementAccount: fakeSettlement,
      withdrawTo: pubkey(user),
    })
    tx.add(instruction)
    const executionReturn = await executeTxSimple(provider.connection, tx, [
      operatorAuthority,
      provider.wallet,
    ])

    expect(provider.connection.getAccountInfo(stakeAccount)).resolves.toBeNull()
    expect(
      (await provider.connection.getAccountInfo(pubkey(user)))?.lamports
    ).toEqual(LAMPORTS_PER_SOL * 2)

    const events = parseCpiEvents(program, executionReturn?.response)
    const e = assertEvent(events, WITHDRAW_STAKE_EVENT)
    assert(e !== undefined)
    expect(e.stakeAccount).toEqual(stakeAccount)
    expect(e.config).toEqual(configAccount)
    expect(e.settlement).toEqual(fakeSettlement)
    expect(e.settlementStakerAuthority).toEqual(settlementAuth)
    expect(e.operatorAuthority).toEqual(operatorAuthority.publicKey)
    expect(e.stakeAccount).toEqual(stakeAccount)
    expect(e.withdrawTo).toEqual(pubkey(user))
  })
})
