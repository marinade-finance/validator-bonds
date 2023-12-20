import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  MERGE_EVENT,
  MergeEvent,
  ValidatorBondsProgram,
  getStakeAccount,
  mergeInstruction,
  withdrawerAuthority,
} from '../../src'
import { initTest } from './testValidator'
import { executeInitConfigInstruction } from '../utils/testTransactions'
import { ExtendedProvider } from '../utils/provider'
import { authorizeStakeAccount, delegatedStakeAccount } from '../utils/staking'

describe('Validator Bonds fund bond', () => {
  let provider: ExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey

  beforeAll(async () => {
    ;({ provider, program } = await initTest())
  })

  afterAll(async () => {
    // workaround: "Jest has detected the following 1 open handle", see `initConfig.spec.ts`
    await new Promise(resolve => setTimeout(resolve, 500))
  })

  beforeEach(async () => {
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
    }))
  })

  it('merge', async () => {
    const event = new Promise<MergeEvent>(resolve => {
      const listener = program.addEventListener(MERGE_EVENT, async event => {
        await program.removeEventListener(listener)
        resolve(event)
      })
    })

    const [bondWithdrawer] = withdrawerAuthority(
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

    const { instruction } = await mergeInstruction({
      program,
      configAccount,
      sourceStakeAccount: stakeAccount2,
      destinationStakeAccount: stakeAccount1,
    })
    await provider.sendIx([], instruction)

    const stakeAccountData = await getStakeAccount(provider, stakeAccount1)
    expect(stakeAccountData.staker).toEqual(bondWithdrawer)
    expect(stakeAccountData.withdrawer).toEqual(bondWithdrawer)
    expect(stakeAccountData.isLockedUp).toBeFalsy()
    expect(stakeAccountData.balanceLamports).toEqual(lamports1 + lamports2)
    expect(
      provider.connection.getAccountInfo(stakeAccount2)
    ).resolves.toBeNull()

    await event.then(e => {
      expect(e.config).toEqual(configAccount)
      expect(e.destinationStake).toEqual(stakeAccount1)
      expect(e.destinationDelegation?.voterPubkey).toEqual(voteAccount)
      expect(e.sourceStake).toEqual(stakeAccount2)
      expect(e.sourceDelegation?.voterPubkey).toEqual(voteAccount)
      expect(e.stakerAuthority).toEqual(bondWithdrawer)
    })
  })
})
