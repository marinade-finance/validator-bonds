import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  WITHDRAW_STAKE_EVENT,
  WithdrawStakeEvent,
  getStakeAccount,
  settlementStakerAuthority,
  withdrawStakeInstruction,
  bondsWithdrawerAuthority,
} from '../../src'
import { initTest } from './testValidator'
import { executeInitConfigInstruction } from '../utils/testTransactions'
import { ExtendedProvider } from '@marinade.finance/web3js-common'
import { createSettlementFundedInitializedStake } from '../utils/staking'
import { createUserAndFund, pubkey } from '@marinade.finance/web3js-common'

describe('Validator Bonds withdraw settlement stake account', () => {
  let provider: ExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let operatorAuthority: Keypair

  beforeAll(async () => {
    ;({ provider, program } = await initTest())
  })

  afterAll(async () => {
    // workaround: "Jest has detected the following 1 open handle", see `initConfig.spec.ts`
    await new Promise(resolve => setTimeout(resolve, 500))
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
    const event = new Promise<WithdrawStakeEvent>(resolve => {
      const listener = program.addEventListener(
        WITHDRAW_STAKE_EVENT,
        async event => {
          await program.removeEventListener(listener)
          resolve(event)
        }
      )
    })

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

    const { instruction } = await withdrawStakeInstruction({
      program,
      configAccount,
      stakeAccount,
      settlementAccount: fakeSettlement,
      withdrawTo: pubkey(user),
    })
    await provider.sendIx([operatorAuthority], instruction)

    expect(provider.connection.getAccountInfo(stakeAccount)).resolves.toBeNull()
    expect(
      (await provider.connection.getAccountInfo(pubkey(user)))?.lamports
    ).toEqual(LAMPORTS_PER_SOL * 2)

    await event.then(e => {
      expect(e.stakeAccount).toEqual(stakeAccount)
      expect(e.config).toEqual(configAccount)
      expect(e.settlement).toEqual(fakeSettlement)
      expect(e.settlementStakerAuthority).toEqual(settlementAuth)
      expect(e.operatorAuthority).toEqual(operatorAuthority.publicKey)
      expect(e.stakeAccount).toEqual(stakeAccount)
      expect(e.withdrawTo).toEqual(pubkey(user))
    })
  })
})
