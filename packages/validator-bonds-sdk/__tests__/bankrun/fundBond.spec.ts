import {
  Bond,
  Config,
  ValidatorBondsProgram,
  fundBondInstruction,
  getBond,
  getConfig,
  withdrawerAuthority,
} from '../../src'
import {
  BankrunExtendedProvider,
  initBankrunTest,
  warpToEpoch,
  warpToNextEpoch,
} from './bankrun'
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
  initializedStakeAccount,
} from '../utils/staking'
import { checkAnchorErrorMessage, signer } from '../utils/helpers'
import { BN } from 'bn.js'

describe('Validator Bonds fund bond account', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let config: ProgramAccount<Config>
  let bond: ProgramAccount<Bond>
  let bondAuthority: Keypair
  const startUpEpoch = Math.floor(Math.random() * 100) + 100

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
    warpToEpoch(provider, startUpEpoch)
  })

  beforeEach(async () => {
    const { configAccount } = await executeInitConfigInstruction({
      program,
      provider,
    })
    config = {
      publicKey: configAccount,
      account: await getConfig(program, configAccount),
    }
    const { voteAccount, validatorIdentity } = await createVoteAccount(provider)
    bondAuthority = Keypair.generate()
    const { bondAccount } = await executeInitBondInstruction(
      program,
      provider,
      config.publicKey,
      bondAuthority,
      voteAccount,
      validatorIdentity,
      123
    )
    bond = {
      publicKey: bondAccount,
      account: await getBond(program, bondAccount),
    }
  })

  it('cannot fund with non-delegated stake account', async () => {
    const { stakeAccount: nonDelegatedStakeAccount, withdrawer } =
      await initializedStakeAccount(provider)
    const { instruction } = await fundBondInstruction({
      program,
      configAccount: config.publicKey,
      bondAccount: bond.publicKey,
      stakeAccount: nonDelegatedStakeAccount,
      stakeAccountAuthority: withdrawer,
    })
    try {
      await provider.sendIx([signer(withdrawer)], instruction)
      throw new Error('failure expected as not delegated')
    } catch (e) {
      checkAnchorErrorMessage(e, 6017, 'cannot be used for bonds')
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
      configAccount: config.publicKey,
      bondAccount: bond.publicKey,
      stakeAccount,
      stakeAccountAuthority: withdrawer,
    })
    try {
      await provider.sendIx([withdrawer], instruction)
      throw new Error('failure expected as not activated')
    } catch (e) {
      checkAnchorErrorMessage(e, 6023, 'Stake account is not fully activated')
    }

    await warpToNextEpoch(provider)
    try {
      await provider.sendIx([withdrawer], instruction)
    } catch (e) {
      checkAnchorErrorMessage(e, 6018, 'delegated to a wrong validator')
    }
  })

  it('cannot fund bond with lockup delegation', async () => {
    const nextEpoch =
      Number((await provider.context.banksClient.getClock()).epoch) + 1
    const { stakeAccount, withdrawer } = await delegatedStakeAccount({
      provider,
      lamports: LAMPORTS_PER_SOL * 2,
      voteAccountToDelegate: bond.account.validatorVoteAccount,
      lockup: {
        custodian: Keypair.generate().publicKey,
        epoch: nextEpoch + 1,
        unixTimestamp: 0,
      },
    })

    const { instruction } = await fundBondInstruction({
      program,
      configAccount: config.publicKey,
      bondAccount: bond.publicKey,
      stakeAccount,
      stakeAccountAuthority: withdrawer,
    })

    warpToEpoch(provider, nextEpoch)
    try {
      await provider.sendIx([withdrawer], instruction)
      throw new Error('failure expected as should be locked')
    } catch (e) {
      checkAnchorErrorMessage(e, 6028, 'stake account is locked-up')
    }
  })

  it('fund bond', async () => {
    const { stakeAccount, withdrawer } = await delegatedStakeAccount({
      provider,
      lamports: LAMPORTS_PER_SOL * 2,
      voteAccountToDelegate: bond.account.validatorVoteAccount,
    })
    const [bondWithdrawer] = withdrawerAuthority(
      config.publicKey,
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
      configAccount: config.publicKey,
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
  })
})
