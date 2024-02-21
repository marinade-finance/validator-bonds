import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  FUND_BOND_EVENT,
  FundBondEvent,
  ValidatorBondsProgram,
  fundBondInstruction,
  getStakeAccount,
  withdrawerAuthority,
} from '../../src'
import { initTest, waitForStakeAccountActivation } from './testValidator'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '../utils/testTransactions'
import { ExtendedProvider } from '../utils/provider'
import { createVoteAccount, delegatedStakeAccount } from '../utils/staking'

describe('Validator Bonds fund bond', () => {
  let provider: ExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let bondAccount: PublicKey
  let voteAccount: PublicKey

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
    const event = new Promise<FundBondEvent>(resolve => {
      const listener = program.addEventListener(
        FUND_BOND_EVENT,
        async event => {
          await program.removeEventListener(listener)
          resolve(event)
        }
      )
    })

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
    })

    const { instruction } = await fundBondInstruction({
      program,
      bondAccount,
      configAccount,
      stakeAccount,
      stakeAccountAuthority: withdrawer,
    })
    await provider.sendIx([withdrawer], instruction)

    const stakeAccountData = await getStakeAccount(provider, stakeAccount)
    const [bondWithdrawer] = withdrawerAuthority(
      configAccount,
      program.programId
    )
    expect(stakeAccountData.staker).toEqual(bondWithdrawer)
    expect(stakeAccountData.withdrawer).toEqual(bondWithdrawer)
    expect(stakeAccountData.isLockedUp).toBeFalsy()

    await event.then(e => {
      expect(e.bond).toEqual(bondAccount)
      expect(e.depositedAmount).toEqual(2 * LAMPORTS_PER_SOL)
      expect(e.stakeAccount).toEqual(stakeAccount)
      expect(e.stakeAuthoritySigner).toEqual(withdrawer.publicKey)
      expect(e.voteAccount).toEqual(voteAccount)
    })
  })
})
