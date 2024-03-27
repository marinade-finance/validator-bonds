import {
  Bond,
  Errors,
  ValidatorBondsProgram,
  fundBondInstruction,
  getBond,
  bondsWithdrawerAuthority,
} from '../../src'
import {
  BankrunExtendedProvider,
  warpToEpoch,
  warpToNextEpoch,
} from '@marinade.finance/bankrun-utils'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '../utils/testTransactions'
import { ProgramAccount } from '@coral-xyz/anchor'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  StakeStates,
  createVoteAccount,
  delegatedStakeAccount,
  getAndCheckStakeAccount,
  createInitializedStakeAccount,
} from '../utils/staking'
import { BN } from 'bn.js'
import { signer } from '@marinade.finance/web3js-common'
import { verifyError } from '@marinade.finance/anchor-common'
import { initBankrunTest } from './bankrun'

describe('Validator Bonds fund bond account', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let bond: ProgramAccount<Bond>
  let bondAuthority: Keypair
  const startUpEpoch = Math.floor(Math.random() * 100) + 100

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
    warpToEpoch(provider, startUpEpoch)
  })

  beforeEach(async () => {
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
    }))
    const { voteAccount, validatorIdentity } = await createVoteAccount({
      provider,
    })
    bondAuthority = Keypair.generate()
    const { bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      bondAuthority,
      voteAccount,
      validatorIdentity,
      cpmpe: 123,
    })
    bond = {
      publicKey: bondAccount,
      account: await getBond(program, bondAccount),
    }
  })

  it('cannot fund with non-delegated stake account', async () => {
    const { stakeAccount: nonDelegatedStakeAccount, withdrawer } =
      await createInitializedStakeAccount({ provider })
    const { instruction } = await fundBondInstruction({
      program,
      configAccount,
      bondAccount: bond.publicKey,
      stakeAccount: nonDelegatedStakeAccount,
      stakeAccountAuthority: withdrawer,
    })
    try {
      await provider.sendIx([signer(withdrawer)], instruction)
      throw new Error('failure expected as not delegated')
    } catch (e) {
      verifyError(e, Errors, 6019, 'cannot be used for bonds')
    }
  })

  it('cannot fund bond non activated with wrong delegation', async () => {
    // random vote account is generated on the call of method delegatedStakeAccount
    const { stakeAccount, withdrawer } = await delegatedStakeAccount({
      provider,
      lamports: LAMPORTS_PER_SOL * 2,
    })
    const { instruction } = await fundBondInstruction({
      program,
      configAccount,
      bondAccount: bond.publicKey,
      stakeAccount,
      stakeAccountAuthority: withdrawer,
    })
    try {
      await provider.sendIx([withdrawer], instruction)
      throw new Error('failure expected as not activated')
    } catch (e) {
      verifyError(e, Errors, 6025, 'Stake account is not fully activated')
    }

    await warpToNextEpoch(provider)
    try {
      await provider.sendIx([withdrawer], instruction)
      throw new Error('failure expected as delegated to wrong validator')
    } catch (e) {
      verifyError(e, Errors, 6020, 'delegated to a wrong validator')
    }
  })

  it('cannot fund bond with lockup delegation', async () => {
    const nextEpoch =
      Number((await provider.context.banksClient.getClock()).epoch) + 1
    const { stakeAccount, withdrawer } = await delegatedStakeAccount({
      provider,
      lamports: LAMPORTS_PER_SOL * 2,
      voteAccountToDelegate: bond.account.voteAccount,
      lockup: {
        custodian: Keypair.generate().publicKey,
        epoch: nextEpoch + 1,
        unixTimestamp: 0,
      },
    })

    const { instruction } = await fundBondInstruction({
      program,
      configAccount,
      bondAccount: bond.publicKey,
      stakeAccount,
      stakeAccountAuthority: withdrawer,
    })

    warpToEpoch(provider, nextEpoch)
    try {
      await provider.sendIx([withdrawer], instruction)
      throw new Error('failure expected as should be locked')
    } catch (e) {
      verifyError(e, Errors, 6030, 'stake account is locked-up')
    }
  })

  it('fund bond', async () => {
    const { stakeAccount, withdrawer } = await delegatedStakeAccount({
      provider,
      lamports: LAMPORTS_PER_SOL * 2,
      voteAccountToDelegate: bond.account.voteAccount,
    })
    const [bondWithdrawer] = bondsWithdrawerAuthority(
      configAccount,
      program.programId
    )

    const [stakeAccountData] = await getAndCheckStakeAccount(
      provider,
      stakeAccount,
      StakeStates.Delegated
    )
    expect(stakeAccountData.Stake?.meta.authorized.withdrawer).not.toEqual(
      bondWithdrawer
    )
    expect(stakeAccountData.Stake?.meta.authorized.staker).not.toEqual(
      bondWithdrawer
    )

    const { instruction } = await fundBondInstruction({
      program,
      configAccount,
      bondAccount: bond.publicKey,
      stakeAccount,
      stakeAccountAuthority: withdrawer,
    })
    await warpToNextEpoch(provider)
    await provider.sendIx([withdrawer], instruction)

    const [stakeAccountData2, stakeAccountInfo] = await getAndCheckStakeAccount(
      provider,
      stakeAccount,
      StakeStates.Delegated
    )
    expect(stakeAccountInfo.lamports).toEqual(LAMPORTS_PER_SOL * 2)
    expect(stakeAccountData2.Stake?.meta.authorized.staker).toEqual(
      bondWithdrawer
    )
    expect(stakeAccountData2.Stake?.meta.authorized.withdrawer).toEqual(
      bondWithdrawer
    )
    expect(stakeAccountData2.Stake?.meta.lockup).toEqual({
      custodian: PublicKey.default,
      epoch: new BN(0),
      unixTimestamp: new BN(0),
    })

    // double funding the same account means error as the stake authorities changed
    await warpToNextEpoch(provider)
    try {
      await provider.sendIx([provider.wallet, withdrawer], instruction)
      throw new Error('failure expected; already funded account')
    } catch (e) {
      verifyError(e, Errors, 6012, 'Wrong withdrawer authority')
    }
  })
})
