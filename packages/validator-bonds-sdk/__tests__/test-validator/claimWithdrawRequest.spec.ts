import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  CLAIM_WITHDRAW_REQUEST_EVENT,
  ClaimWithdrawRequestEvent,
  ValidatorBondsProgram,
  bondsWithdrawerAuthority,
  getStakeAccount,
  getVoteAccount,
  getWithdrawRequest,
} from '../../src'
import { initTest, waitForStakeAccountActivation } from './testValidator'
import {
  executeFundBondInstruction,
  executeInitConfigInstruction,
  executeNewWithdrawRequest,
} from '../utils/testTransactions'
import { ExtendedProvider } from '../utils/provider'
import { delegatedStakeAccount } from '../utils/staking'
import { claimWithdrawRequestInstruction } from '../../src/instructions/claimWithdrawRequest'
import BN from 'bn.js'

describe('Validator Bonds claim withdraw request', () => {
  let provider: ExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  const requestedAmount = 2 * LAMPORTS_PER_SOL

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
      withdrawLockupEpochs: 0,
    }))
  })

  it('claim withdraw request', async () => {
    const event = new Promise<ClaimWithdrawRequestEvent>(resolve => {
      const listener = program.addEventListener(
        CLAIM_WITHDRAW_REQUEST_EVENT,
        async event => {
          await program.removeEventListener(listener)
          resolve(event)
        }
      )
    })

    const { withdrawRequestAccount, bondAccount, voteAccount, bondAuthority } =
      await executeNewWithdrawRequest({
        program,
        provider,
        configAccount,
        amount: requestedAmount,
      })

    const { stakeAccount, withdrawer } = await delegatedStakeAccount({
      provider,
      lamports: requestedAmount * 2,
      voteAccountToDelegate: voteAccount,
    })
    console.debug(
      `Waiting for activation of stake account: ${stakeAccount.toBase58()}`
    )
    await waitForStakeAccountActivation({
      stakeAccount,
      connection: provider.connection,
    })
    await executeFundBondInstruction({
      program,
      provider,
      bondAccount,
      stakeAccount,
      stakeAccountAuthority: withdrawer,
    })

    let stakeAccountData = await getStakeAccount(program, stakeAccount)
    const [bondsWithdrawerAuth] = bondsWithdrawerAuthority(
      configAccount,
      program.programId
    )
    expect(stakeAccountData.staker).toEqual(bondsWithdrawerAuth)
    expect(stakeAccountData.withdrawer).toEqual(bondsWithdrawerAuth)
    const withdrawRequestData = await getWithdrawRequest(
      program,
      withdrawRequestAccount
    )
    expect(withdrawRequestData.bond).toEqual(bondAccount)
    expect(withdrawRequestData.withdrawnAmount).toEqual(0)

    const { instruction, splitStakeAccount } =
      await claimWithdrawRequestInstruction({
        program,
        authority: bondAuthority,
        withdrawRequestAccount,
        bondAccount,
        stakeAccount,
      })

    await provider.sendIx([splitStakeAccount, bondAuthority], instruction)

    stakeAccountData = await getStakeAccount(provider, stakeAccount)
    const voteAccountData = await getVoteAccount(provider, voteAccount)
    expect(stakeAccountData.staker).toEqual(
      voteAccountData.account.data.nodePubkey
    )
    expect(stakeAccountData.withdrawer).toEqual(
      voteAccountData.account.data.nodePubkey
    )

    const withdrawRequestDataAfter = await getWithdrawRequest(
      program,
      withdrawRequestAccount
    )
    expect(withdrawRequestDataAfter.withdrawnAmount).toEqual(requestedAmount)
    expect(withdrawRequestDataAfter.requestedAmount).toEqual(requestedAmount)
    const splitStakeLamports = (
      await provider.connection.getAccountInfo(splitStakeAccount.publicKey)
    )?.lamports

    await event.then(e => {
      expect(e.bond).toEqual(bondAccount)
      expect(e.stakeAccount).toEqual(stakeAccount)
      expect(e.newStakeAccountOwner).toEqual(
        voteAccountData.account.data.nodePubkey
      )
      expect(e.splitStake?.amount).toEqual(splitStakeLamports)
      expect(e.splitStake?.address).toEqual(splitStakeAccount.publicKey)
      expect(e.voteAccount).toEqual(voteAccount)
      expect(e.withdrawRequest).toEqual(withdrawRequestAccount)
      expect(e.withdrawingAmount).toEqual(requestedAmount)
      expect(e.withdrawnAmount).toEqual({
        old: new BN(0),
        new: requestedAmount,
      })
    })
  })
})
