import {
  Config,
  ValidatorBondsProgram,
  bondAddress,
  getConfig,
  mergeInstruction,
  settlementAddress,
  settlementAuthority,
  withdrawerAuthority,
} from '../../src'
import {
  BankrunExtendedProvider,
  assertNotExist,
  initBankrunTest,
  warpToEpoch,
} from './bankrun'
import {
  executeInitConfigInstruction,
  executeWithdraw,
} from '../utils/testTransactions'
import { ProgramAccount } from '@coral-xyz/anchor'
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SYSVAR_STAKE_HISTORY_PUBKEY,
  StakeProgram,
} from '@solana/web3.js'
import {
  authorizeStakeAccount,
  createVoteAccount,
  delegatedStakeAccount,
  initializedStakeAccount,
} from '../utils/staking'
import { checkAnchorErrorMessage, pubkey } from '../utils/helpers'

// -------------------
/// TODO:
//   - missing handling for settlement authority
//   - add a test for lockup checks
// ------------------

describe('Validator Bonds fund bond account', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let config: ProgramAccount<Config>
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
  })

  it('cannot merge with staker authority not belonging to bonds', async () => {
    const { stakeAccount: nonDelegatedStakeAccount, staker } =
      await initializedStakeAccount(provider)
    const { stakeAccount: nonDelegatedStakeAccount2 } =
      await initializedStakeAccount(provider, undefined, undefined, staker)
    const instruction = await program.methods
      .merge({
        settlement: PublicKey.default,
      })
      .accounts({
        config: config.publicKey,
        sourceStake: nonDelegatedStakeAccount2,
        destinationStake: nonDelegatedStakeAccount,
        stakerAuthority: pubkey(staker),
        stakeHistory: SYSVAR_STAKE_HISTORY_PUBKEY,
        stakeProgram: StakeProgram.programId,
      })
      .instruction()
    try {
      await provider.sendIx([], instruction)
      throw new Error(
        'failure expected as accounts are not owned by bonds program'
      )
    } catch (e) {
      checkAnchorErrorMessage(e, 6043, 'does not belong to bonds program')
    }
  })

  it('cannot merge with wrong withdrawer authorities not belonging to bonds', async () => {
    const [bondWithdrawer] = withdrawerAuthority(
      config.publicKey,
      program.programId
    )
    const { stakeAccount: nonDelegatedStakeAccount } =
      await initializedStakeAccount(
        provider,
        undefined,
        undefined,
        bondWithdrawer
      )
    const { stakeAccount: nonDelegatedStakeAccount2 } =
      await initializedStakeAccount(
        provider,
        undefined,
        undefined,
        bondWithdrawer
      )
    const { instruction } = await mergeInstruction({
      program,
      configAccount: config.publicKey,
      sourceStakeAccount: nonDelegatedStakeAccount2,
      destinationStakeAccount: nonDelegatedStakeAccount,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error(
        'failure expected as accounts are not owned by bonds program'
      )
    } catch (e) {
      checkAnchorErrorMessage(e, 6043, 'does not belong to bonds program')
    }
  })

  it('cannot merge with non delegated stake state', async () => {
    const [bondWithdrawer] = withdrawerAuthority(
      config.publicKey,
      program.programId
    )
    const { stakeAccount: nonDelegatedStakeAccount } =
      await initializedStakeAccount(
        provider,
        undefined,
        undefined,
        bondWithdrawer,
        bondWithdrawer
      )
    const { stakeAccount: nonDelegatedStakeAccount2 } =
      await initializedStakeAccount(
        provider,
        undefined,
        undefined,
        bondWithdrawer,
        bondWithdrawer
      )
    const { instruction } = await mergeInstruction({
      program,
      configAccount: config.publicKey,
      sourceStakeAccount: nonDelegatedStakeAccount,
      destinationStakeAccount: nonDelegatedStakeAccount2,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error('failure expected; non delegated')
    } catch (e) {
      checkAnchorErrorMessage(
        e,
        6045,
        'Delegation of provided stake account mismatches'
      )
    }
  })

  it('cannot merge different delegation', async () => {
    const [bondWithdrawer] = withdrawerAuthority(
      config.publicKey,
      program.programId
    )
    const { stakeAccount: stakeAccount1, withdrawer: withdrawer1 } =
      await delegatedStakeAccount({
        provider,
        lamports: 6 * LAMPORTS_PER_SOL,
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
        lamports: 3 * LAMPORTS_PER_SOL,
        lockup: undefined,
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
      configAccount: config.publicKey,
      sourceStakeAccount: stakeAccount2,
      destinationStakeAccount: stakeAccount1,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error('failure expected; wrong delegation')
    } catch (e) {
      checkAnchorErrorMessage(
        e,
        6045,
        'Delegation of provided stake account mismatches'
      )
    }
    const { instruction: instruction2 } = await mergeInstruction({
      program,
      configAccount: config.publicKey,
      sourceStakeAccount: stakeAccount1,
      destinationStakeAccount: stakeAccount2,
    })
    try {
      await provider.sendIx([], instruction2)
      throw new Error('failure expected; wrong delegation')
    } catch (e) {
      checkAnchorErrorMessage(
        e,
        6045,
        'Delegation of provided stake account mismatches'
      )
    }
  })

  it('cannot merge different deactivated delegation', async () => {
    const [bondWithdrawer] = withdrawerAuthority(
      config.publicKey,
      program.programId
    )
    const {
      stakeAccount: stakeAccount1,
      withdrawer: withdrawer1,
      staker: staker1,
    } = await delegatedStakeAccount({
      provider,
      lamports: 6 * LAMPORTS_PER_SOL,
      lockup: undefined,
    })

    const {
      stakeAccount: stakeAccount2,
      withdrawer: withdrawer2,
      staker: staker2,
    } = await delegatedStakeAccount({
      provider,
      lamports: 3 * LAMPORTS_PER_SOL,
      lockup: undefined,
    })

    // warp to make the funds effective in stake account
    warpToEpoch(
      provider,
      Number((await provider.context.banksClient.getClock()).epoch) + 1
    )
    const deactivate1Ix = StakeProgram.deactivate({
      stakePubkey: stakeAccount1,
      authorizedPubkey: staker1.publicKey,
    })
    const deactivate2Ix = StakeProgram.deactivate({
      stakePubkey: stakeAccount2,
      authorizedPubkey: staker2.publicKey,
    })
    await provider.sendIx([staker1, staker2], deactivate1Ix, deactivate2Ix)
    // deactivated but funds are still effective, withdraw cannot work
    try {
      const withdrawIx = StakeProgram.withdraw({
        stakePubkey: stakeAccount1,
        authorizedPubkey: withdrawer1.publicKey,
        lamports: 1,
        toPubkey: provider.walletPubkey,
      })
      await provider.sendIx([withdrawer1], withdrawIx)
      throw new Error('failure expected; funds still effective')
    } catch (e) {
      if (
        !(e as Error).message.includes('insufficient funds for instruction')
      ) {
        console.error(
          'Expected failure as stake account funds are still effective, ' +
            `failure happens but with a wrong message: '${
              (e as Error).message
            }'`
        )
        throw e
      }
    }
    // making funds ineffective, withdraw works
    warpToEpoch(
      provider,
      Number((await provider.context.banksClient.getClock()).epoch) + 1
    )
    executeWithdraw(provider, stakeAccount1, withdrawer1, undefined, 1)

    await authorizeStakeAccount({
      provider,
      authority: withdrawer1,
      stakeAccount: stakeAccount1,
      staker: bondWithdrawer,
      withdrawer: bondWithdrawer,
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
      configAccount: config.publicKey,
      sourceStakeAccount: stakeAccount2,
      destinationStakeAccount: stakeAccount1,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error('failure expected; wrong delegation')
    } catch (e) {
      checkAnchorErrorMessage(
        e,
        6045,
        'Delegation of provided stake account mismatches'
      )
    }
    const { instruction: instruction2 } = await mergeInstruction({
      program,
      configAccount: config.publicKey,
      sourceStakeAccount: stakeAccount1,
      destinationStakeAccount: stakeAccount2,
    })
    try {
      await provider.sendIx([], instruction2)
      throw new Error('failure expected; wrong delegation')
    } catch (e) {
      checkAnchorErrorMessage(
        e,
        6045,
        'Delegation of provided stake account mismatches'
      )
    }
  })

  it('cannot merge settlement and bond authority', async () => {
    const voteAccount = (await createVoteAccount(provider)).voteAccount
    const [bondWithdrawer] = withdrawerAuthority(
      config.publicKey,
      program.programId
    )
    const [bond] = bondAddress(config.publicKey, program.programId)
    const [settlement] = settlementAddress(
      bond,
      Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
      program.programId
    )
    const [settlementStaker] = settlementAuthority(
      settlement,
      program.programId
    )
    const { stakeAccount: stakeAccount1, withdrawer: withdrawer1 } =
      await delegatedStakeAccount({
        provider,
        lamports: 6 * LAMPORTS_PER_SOL,
        lockup: undefined,
        voteAccountToDelegate: voteAccount,
      })
    await authorizeStakeAccount({
      provider,
      authority: withdrawer1,
      stakeAccount: stakeAccount1,
      withdrawer: bondWithdrawer,
      staker: bondWithdrawer,
    })

    const { stakeAccount: stakeAccount2, withdrawer: withdrawer2 } =
      await delegatedStakeAccount({
        provider,
        lamports: 3 * LAMPORTS_PER_SOL,
        lockup: undefined,
        voteAccountToDelegate: voteAccount,
      })
    await authorizeStakeAccount({
      provider,
      authority: withdrawer2,
      stakeAccount: stakeAccount2,
      withdrawer: bondWithdrawer,
      staker: settlementStaker,
    })

    const { instruction } = await mergeInstruction({
      program,
      configAccount: config.publicKey,
      sourceStakeAccount: stakeAccount2,
      destinationStakeAccount: stakeAccount1,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error('failure expected; wrong authorities')
    } catch (e) {
      checkAnchorErrorMessage(e, 6042, 'staker does not match')
    }
    const { instruction: instruction2 } = await mergeInstruction({
      program,
      configAccount: config.publicKey,
      sourceStakeAccount: stakeAccount1,
      destinationStakeAccount: stakeAccount2,
    })
    try {
      await provider.sendIx([], instruction2)
      throw new Error('failure expected; wrong authorities')
    } catch (e) {
      checkAnchorErrorMessage(e, 6042, 'staker does not match')
    }
  })

  it('merging', async () => {
    const [bondWithdrawer] = withdrawerAuthority(
      config.publicKey,
      program.programId
    )
    const {
      stakeAccount: stakeAccount1,
      withdrawer: withdrawer1,
      voteAccount,
    } = await delegatedStakeAccount({
      provider,
      lamports: 6 * LAMPORTS_PER_SOL,
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
        lamports: 3 * LAMPORTS_PER_SOL,
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
      configAccount: config.publicKey,
      sourceStakeAccount: stakeAccount2,
      destinationStakeAccount: stakeAccount1,
    })
    await provider.sendIx([], instruction)

    await assertNotExist(provider, stakeAccount2)
    const stakeAccount = await provider.connection.getAccountInfo(stakeAccount1)
    expect(stakeAccount?.lamports).toEqual(9 * LAMPORTS_PER_SOL)
  })
})
