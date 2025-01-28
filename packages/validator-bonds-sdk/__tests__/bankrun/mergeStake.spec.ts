import {
  Errors,
  ValidatorBondsProgram,
  bondAddress,
  mergeStakeInstruction,
  settlementAddress,
  settlementStakerAuthority,
  bondsWithdrawerAuthority,
  getRentExemptStake,
  getConfig,
  getSettlement,
  fundSettlementInstruction,
  getStakeAccount,
} from '../../src'
import {
  BankrunExtendedProvider,
  assertNotExist,
  currentEpoch,
  warpToEpoch,
  warpToNextEpoch,
} from '@marinade.finance/bankrun-utils'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
  executeWithdraw,
} from '../utils/testTransactions'
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SYSVAR_STAKE_HISTORY_PUBKEY,
  StakeProgram,
} from '@solana/web3.js'
import {
  authorizeStakeAccount,
  createVoteAccount,
  delegatedStakeAccount,
  createInitializedStakeAccount,
  getAndCheckStakeAccount,
  StakeStates,
  createBondsFundedStakeAccount,
} from '../utils/staking'
import { pubkey, signer } from '@marinade.finance/web3js-common'
import { verifyError } from '@marinade.finance/anchor-common'
import { initBankrunTest } from './bankrun'

describe('Staking merge verification/investigation', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let operatorAuthority: Keypair
  const startUpEpoch = Math.floor(Math.random() * 100) + 100

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
    warpToEpoch(provider, startUpEpoch)
  })

  beforeEach(async () => {
    ;({ configAccount, operatorAuthority } = await executeInitConfigInstruction(
      {
        program,
        provider,
      },
    ))
  })

  it('cannot merge with withdrawer authority not belonging to bonds', async () => {
    const { stakeAccount: nonDelegatedStakeAccount, staker } =
      await createInitializedStakeAccount({ provider })
    const { stakeAccount: nonDelegatedStakeAccount2 } =
      await createInitializedStakeAccount({ provider, staker })
    const instruction = await program.methods
      .mergeStake({
        settlement: PublicKey.default,
      })
      .accounts({
        config: configAccount,
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
        'failure expected as accounts are not owned by bonds program',
      )
    } catch (e) {
      verifyError(e, Errors, 6045, 'does not belong to bonds program')
    }
  })

  it('cannot merge same and with wrong withdrawer authorities', async () => {
    const [bondWithdrawer] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
    )
    const { stakeAccount: nonDelegatedStakeAccount, staker } =
      await createInitializedStakeAccount({
        provider,
        withdrawer: bondWithdrawer,
      })
    const { stakeAccount: nonDelegatedStakeAccount2 } =
      await createInitializedStakeAccount({
        provider,
        withdrawer: bondWithdrawer,
        staker,
      })
    const { instruction: ixSameAccounts } = await mergeStakeInstruction({
      program,
      configAccount,
      sourceStakeAccount: nonDelegatedStakeAccount,
      destinationStakeAccount: nonDelegatedStakeAccount,
    })
    try {
      await provider.sendIx([], ixSameAccounts)
      throw new Error('failure expected; trying to merge the same accounts')
    } catch (e) {
      verifyError(e, Errors, 6056, 'Source and destination cannot be the same')
    }

    const { instruction: ixNonBondStaker } = await mergeStakeInstruction({
      program,
      configAccount,
      sourceStakeAccount: nonDelegatedStakeAccount2,
      destinationStakeAccount: nonDelegatedStakeAccount,
      stakerAuthority: pubkey(staker),
      settlementAccount: nonDelegatedStakeAccount,
    })
    try {
      await provider.sendIx([], ixNonBondStaker)
      throw new Error('failure expected; non bond staker')
    } catch (e) {
      verifyError(e, Errors, 6044, 'staker does not match')
    }
  })

  it('merge possible when both is non delegated', async () => {
    const [bondWithdrawer] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
    )
    const { stakeAccount: nonDelegatedStakeAccount } =
      await createInitializedStakeAccount({
        provider,
        withdrawer: bondWithdrawer,
        staker: bondWithdrawer,
      })
    const { stakeAccount: nonDelegatedStakeAccount2 } =
      await createInitializedStakeAccount({
        provider,
        withdrawer: bondWithdrawer,
        staker: bondWithdrawer,
      })
    const { stakeAccount: delegatedStake, withdrawer } =
      await delegatedStakeAccount({
        provider,
      })
    await authorizeStakeAccount({
      provider,
      authority: withdrawer,
      stakeAccount: delegatedStake,
      staker: bondWithdrawer,
      withdrawer: bondWithdrawer,
    })

    const { instruction: ixNonDelegatedAndDelegated } =
      await mergeStakeInstruction({
        program,
        configAccount,
        sourceStakeAccount: delegatedStake,
        destinationStakeAccount: nonDelegatedStakeAccount2,
      })
    try {
      await provider.sendIx([], ixNonDelegatedAndDelegated)
      throw new Error('failure expected; delegated and non-delegated')
    } catch (e) {
      verifyError(
        e,
        Errors,
        6047,
        'Delegation of provided stake account mismatches',
      )
    }

    const { instruction: ixNonDelegated } = await mergeStakeInstruction({
      program,
      configAccount,
      sourceStakeAccount: nonDelegatedStakeAccount,
      destinationStakeAccount: nonDelegatedStakeAccount2,
    })
    await provider.sendIx([], ixNonDelegated)
  })

  it('cannot merge different delegation', async () => {
    const [bondWithdrawer] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
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

    const { instruction } = await mergeStakeInstruction({
      program,
      configAccount,
      sourceStakeAccount: stakeAccount2,
      destinationStakeAccount: stakeAccount1,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error('failure expected; wrong delegation')
    } catch (e) {
      verifyError(
        e,
        Errors,
        6047,
        'Delegation of provided stake account mismatches',
      )
    }
    const { instruction: instruction2 } = await mergeStakeInstruction({
      program,
      configAccount,
      sourceStakeAccount: stakeAccount1,
      destinationStakeAccount: stakeAccount2,
    })
    try {
      await provider.sendIx([], instruction2)
      throw new Error('failure expected; wrong delegation')
    } catch (e) {
      verifyError(
        e,
        Errors,
        6047,
        'Delegation of provided stake account mismatches',
      )
    }
  })

  it('cannot merge different deactivated delegation', async () => {
    const [bondWithdrawer] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
    )
    const {
      stakeAccount: stakeAccount1,
      withdrawer: withdrawer1,
      staker: staker1,
      voteAccount: voteAccount1,
    } = await delegatedStakeAccount({
      provider,
      lamports: 6 * LAMPORTS_PER_SOL,
      lockup: undefined,
    })
    const {
      stakeAccount: stakeAccount2,
      withdrawer: withdrawer2,
      staker: staker2,
      voteAccount: voteAccount2,
    } = await delegatedStakeAccount({
      provider,
      lamports: 3 * LAMPORTS_PER_SOL,
      lockup: undefined,
    })

    // warp to make the funds effective in stake account
    warpToEpoch(
      provider,
      Number((await provider.context.banksClient.getClock()).epoch) + 1,
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
            }'`,
        )
        throw e
      }
    }
    // making funds ineffective, withdraw works
    warpToEpoch(
      provider,
      Number((await provider.context.banksClient.getClock()).epoch) + 1,
    )
    await executeWithdraw(provider, stakeAccount1, withdrawer1, undefined, 1)

    await authorizeStakeAccount({
      provider,
      stakeAccount: stakeAccount1,
      authority: withdrawer1,
      staker: bondWithdrawer,
      withdrawer: bondWithdrawer,
    })
    await authorizeStakeAccount({
      provider,
      stakeAccount: stakeAccount2,
      authority: withdrawer2,
      staker: bondWithdrawer,
      withdrawer: bondWithdrawer,
    })

    const [stakeAccount1Data] = await getAndCheckStakeAccount(
      provider,
      stakeAccount1,
      StakeStates.Delegated,
    )
    expect(stakeAccount1Data.Stake?.stake.delegation.voterPubkey).toEqual(
      voteAccount1,
    )
    const [stakeAccount2Data] = await getAndCheckStakeAccount(
      provider,
      stakeAccount2,
      StakeStates.Delegated,
    )
    expect(stakeAccount2Data.Stake?.stake.delegation.voterPubkey).toEqual(
      voteAccount2,
    )

    const { instruction } = await mergeStakeInstruction({
      program,
      configAccount,
      sourceStakeAccount: stakeAccount2,
      destinationStakeAccount: stakeAccount1,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error('failure expected; wrong delegation')
    } catch (e) {
      verifyError(
        e,
        Errors,
        6047,
        'Delegation of provided stake account mismatches',
      )
    }
    const { instruction: instruction2 } = await mergeStakeInstruction({
      program,
      configAccount,
      sourceStakeAccount: stakeAccount1,
      destinationStakeAccount: stakeAccount2,
    })
    try {
      await provider.sendIx([], instruction2)
      throw new Error('failure expected; wrong delegation')
    } catch (e) {
      verifyError(
        e,
        Errors,
        6047,
        'Delegation of provided stake account mismatches',
      )
    }
  })

  it('cannot merge settlement and bond authority', async () => {
    const voteAccount = (await createVoteAccount({ provider })).voteAccount
    const [bondWithdrawer] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
    )
    const currentEpoch = (await provider.context.banksClient.getClock()).epoch
    const [bond] = bondAddress(configAccount, program.programId)
    const [settlement] = settlementAddress(
      bond,
      Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
      currentEpoch,
      program.programId,
    )
    const [settlementStaker] = settlementStakerAuthority(
      settlement,
      program.programId,
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

    const { instruction } = await mergeStakeInstruction({
      program,
      configAccount,
      sourceStakeAccount: stakeAccount2,
      destinationStakeAccount: stakeAccount1,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error('failure expected; wrong authorities')
    } catch (e) {
      verifyError(e, Errors, 6044, 'staker does not match')
    }
    const { instruction: instruction2 } = await mergeStakeInstruction({
      program,
      configAccount,
      sourceStakeAccount: stakeAccount1,
      destinationStakeAccount: stakeAccount2,
    })
    try {
      await provider.sendIx([], instruction2)
      throw new Error('failure expected; wrong authorities')
    } catch (e) {
      verifyError(e, Errors, 6044, 'staker does not match')
    }
  })

  it('merging when funded to bond', async () => {
    const [bondWithdrawer] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
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
    const { instruction } = await mergeStakeInstruction({
      program,
      configAccount,
      sourceStakeAccount: stakeAccount2,
      destinationStakeAccount: stakeAccount1,
    })
    await provider.sendIx([], instruction)

    await assertNotExist(provider, stakeAccount2)
    const stakeAccount = await provider.connection.getAccountInfo(stakeAccount1)
    expect(stakeAccount?.lamports).toEqual(9 * LAMPORTS_PER_SOL)
  })

  it('merging when funded to settlement', async () => {
    const { voteAccount, validatorIdentity } = await createVoteAccount({
      provider,
    })
    await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount,
      validatorIdentity,
    })
    const config = await getConfig(program, configAccount)

    const epoch = await currentEpoch(provider)
    const maxTotalClaim = LAMPORTS_PER_SOL * 10
    const { settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      maxTotalClaim,
      currentEpoch: epoch,
    })

    const rentExemptStake = await getRentExemptStake(provider)
    const stakeAccountMinimalAmount =
      rentExemptStake + config.minimumStakeLamports.toNumber()
    const lamportsToFund1 = maxTotalClaim / 2 + 2 * LAMPORTS_PER_SOL
    const lamportsToFund2 =
      maxTotalClaim -
      lamportsToFund1 +
      2 * stakeAccountMinimalAmount +
      1 * LAMPORTS_PER_SOL

    const stakeAccount1 = await createBondsFundedStakeAccountActivated(
      voteAccount,
      lamportsToFund1,
    )
    const stakeAccountData1 =
      await provider.connection.getAccountInfo(stakeAccount1)
    expect(stakeAccountData1?.lamports).toEqual(lamportsToFund1)
    const stakeAccount2 = await createBondsFundedStakeAccountActivated(
      voteAccount,
      lamportsToFund2,
    )
    const stakeAccountData2 =
      await provider.connection.getAccountInfo(stakeAccount2)
    expect(stakeAccountData2?.lamports).toEqual(lamportsToFund2)

    const settlementData = await getSettlement(program, settlementAccount)
    expect(settlementData.lamportsFunded).toEqual(0)

    const { instruction: ix1, splitStakeAccount: split1 } =
      await fundSettlementInstruction({
        program,
        settlementAccount,
        stakeAccount: stakeAccount1,
      })
    const { instruction: ix2, splitStakeAccount: split2 } =
      await fundSettlementInstruction({
        program,
        settlementAccount,
        stakeAccount: stakeAccount2,
      })
    await provider.sendIx(
      [signer(split1), signer(split2), operatorAuthority],
      ix1,
      ix2,
    )

    let settlement = await getSettlement(program, settlementAccount)
    // the amount in stake accounts were set to over-fund by 1 sol that cannot be
    // split to a separate stake account and this one SOL is thus funded on top of required
    expect(settlement.lamportsFunded).toEqual(
      maxTotalClaim + 1 * LAMPORTS_PER_SOL,
    )

    const [withdrawerAuthority] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
    )
    const [stakerAuthority] = settlementStakerAuthority(
      settlementAccount,
      program.programId,
    )
    let stakeAccount1Data = await getStakeAccount(
      program.provider,
      stakeAccount1,
      epoch,
    )
    const stakeAccount2Data = await getStakeAccount(
      program.provider,
      stakeAccount2,
      epoch,
    )
    expect(stakeAccount1Data.balanceLamports).toEqual(lamportsToFund1)
    expect(stakeAccount1Data.voter).toEqual(voteAccount)
    expect(stakeAccount1Data.withdrawer).toEqual(withdrawerAuthority)
    expect(stakeAccount1Data.staker).toEqual(stakerAuthority)
    expect(stakeAccount2Data.balanceLamports).toEqual(lamportsToFund2)
    expect(stakeAccount2Data.voter).toEqual(voteAccount)
    expect(stakeAccount2Data.withdrawer).toEqual(withdrawerAuthority)
    expect(stakeAccount2Data.staker).toEqual(stakerAuthority)

    // waiting to not getting error 0x5 of TransientState for the stake accounts
    await warpToNextEpoch(provider)

    const { instruction } = await mergeStakeInstruction({
      program,
      configAccount,
      sourceStakeAccount: stakeAccount2,
      destinationStakeAccount: stakeAccount1,
      settlementAccount,
      stakerAuthority,
    })
    await provider.sendIx([], instruction)

    await assertNotExist(provider, stakeAccount2)
    stakeAccount1Data = await getStakeAccount(
      program.provider,
      stakeAccount1,
      epoch,
    )
    expect(stakeAccount1Data.staker).toEqual(stakerAuthority)
    expect(stakeAccount1Data.balanceLamports).toEqual(
      lamportsToFund1 + lamportsToFund2,
    )

    settlement = await getSettlement(program, settlementAccount)
    expect(settlement.lamportsFunded).toEqual(
      maxTotalClaim + 1 * LAMPORTS_PER_SOL,
    )
  })

  async function createBondsFundedStakeAccountActivated(
    voteAccount: PublicKey,
    lamports: number,
  ): Promise<PublicKey> {
    const sa = await createBondsFundedStakeAccount({
      program,
      provider,
      voteAccount,
      lamports,
      configAccount,
    })
    await warpToNextEpoch(provider)
    return sa
  }
})
