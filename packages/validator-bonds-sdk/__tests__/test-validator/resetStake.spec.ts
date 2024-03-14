import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  RESET_STAKE_EVENT,
  ResetStakeEvent,
  U64_MAX,
  ValidatorBondsProgram,
  getStakeAccount,
  resetStakeInstruction,
  settlementStakerAuthority,
  bondsWithdrawerAuthority,
} from '../../src'
import { initTest } from './testValidator'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '../utils/testTransactions'
import { ExtendedProvider } from '@marinade.finance/web3js-common'
import {
  createSettlementFundedDelegatedStake,
  createVoteAccount,
} from '../utils/staking'

describe('Validator Bonds reset settlement stake account', () => {
  let provider: ExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let voteAccount: PublicKey
  let bondAccount: PublicKey

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
      configAccount: configAccount,
      voteAccount,
      validatorIdentity,
    }))
  })

  it('reset stake', async () => {
    const event = new Promise<ResetStakeEvent>(resolve => {
      const listener = program.addEventListener(
        RESET_STAKE_EVENT,
        async event => {
          await program.removeEventListener(listener)
          resolve(event)
        }
      )
    })

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

    const { instruction } = await resetStakeInstruction({
      program,
      configAccount,
      stakeAccount,
      voteAccount,
      settlementAccount: fakeSettlement,
    })
    await provider.sendIx([], instruction)

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

    await event.then(e => {
      expect(e.bond).toEqual(bondAccount)
      expect(e.stakeAccount).toEqual(stakeAccount)
      expect(e.config).toEqual(configAccount)
      expect(e.settlement).toEqual(fakeSettlement)
      expect(e.settlementStakerAuthority).toEqual(settlementAuth)
      expect(e.voteAccount).toEqual(voteAccount)
    })
  })
})
