import { verifyError } from '@marinade.finance/anchor-common'
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_STAKE_HISTORY_PUBKEY,
  StakeProgram,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js'

import { initLiteSvmTest, warpToEpoch, warpToNextEpoch } from './litesvm'
import {
  Errors,
  bondsWithdrawerAuthority,
  claimWithdrawRequestInstruction,
  deserializeStakeState,
  emergencyPauseInstruction,
  getBond,
  refundBondBalanceInstruction,
} from '../../src'
import { getSecureRandomInt } from '../utils/helpers'
import {
  authorizeStakeAccount,
  createBondsFundedStakeAccount,
  createDelegatedStakeAccount,
  createInitializedStakeAccount,
  createSettlementFundedDelegatedStake,
  createVoteAccount,
  delegatedStakeAccount,
} from '../utils/staking'
import {
  executeConfigureConfigInstruction,
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitWithdrawRequestInstruction,
} from '../utils/testTransactions'

import type { LiteSvmProvider } from './litesvm'
import type { Bond, ValidatorBondsProgram } from '../../src'
import type { ProgramAccount } from '@coral-xyz/anchor'

describe('Validator Bonds refund bond balance', () => {
  let provider: LiteSvmProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let adminAuthority: Keypair
  let bond: ProgramAccount<Bond>
  let validatorIdentity: Keypair
  const startUpEpoch = getSecureRandomInt(100, 200)
  const withdrawLockupEpochs = 1

  beforeAll(() => {
    ;({ provider, program } = initLiteSvmTest())
    warpToEpoch(provider, startUpEpoch)
  })

  beforeEach(async () => {
    ;({ configAccount, adminAuthority } = await executeInitConfigInstruction({
      program,
      provider,
      withdrawLockupEpochs,
    }))
    const { voteAccount, validatorIdentity: nodeIdentity } =
      await createVoteAccount({ provider })
    validatorIdentity = nodeIdentity
    const { bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount,
      validatorIdentity,
    })
    bond = {
      publicKey: bondAccount,
      account: await getBond(program, bondAccount),
    }
  })

  async function transferToBond(lamports: number) {
    const transferIx = SystemProgram.transfer({
      fromPubkey: provider.walletPubkey,
      toPubkey: bond.publicKey,
      lamports,
    })
    await provider.sendIx([], transferIx)
  }

  async function bondRentExempt(): Promise<number> {
    const bondInfo = await provider.connection.getAccountInfo(bond.publicKey)
    expect(bondInfo).not.toBeNull()
    return await provider.connection.getMinimumBalanceForRentExemption(
      bondInfo!.data.length,
    )
  }

  async function lamportsOf(address: PublicKey): Promise<number> {
    const info = await provider.connection.getAccountInfo(address)
    expect(info).not.toBeNull()
    return info!.lamports
  }

  it('refund bond balance to bond funded stake account', async () => {
    const stakeLamports = 2 * LAMPORTS_PER_SOL
    const excess = 2.5 * LAMPORTS_PER_SOL
    const stakeAccount = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      lamports: stakeLamports,
      voteAccount: bond.account.voteAccount,
    })
    await transferToBond(excess)

    const rentExempt = await bondRentExempt()
    expect(await lamportsOf(bond.publicKey)).toEqual(rentExempt + excess)

    const { instruction } = await refundBondBalanceInstruction({
      program,
      configAccount,
      bondAccount: bond.publicKey,
      stakeAccount,
    })
    await provider.sendIx([], instruction)

    expect(await lamportsOf(bond.publicKey)).toEqual(rentExempt)
    expect(await lamportsOf(stakeAccount)).toEqual(stakeLamports + excess)
  })

  it('refund dust amount', async () => {
    const stakeLamports = 2 * LAMPORTS_PER_SOL
    const dust = 12345
    const stakeAccount = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      lamports: stakeLamports,
      voteAccount: bond.account.voteAccount,
    })
    await transferToBond(dust)

    const { instruction } = await refundBondBalanceInstruction({
      program,
      configAccount,
      bondAccount: bond.publicKey,
      stakeAccount,
    })
    await provider.sendIx([], instruction)

    expect(await lamportsOf(bond.publicKey)).toEqual(await bondRentExempt())
    expect(await lamportsOf(stakeAccount)).toEqual(stakeLamports + dust)
  })

  it('cannot refund when no excess lamports', async () => {
    const stakeAccount = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      lamports: 2 * LAMPORTS_PER_SOL,
      voteAccount: bond.account.voteAccount,
    })
    const { instruction } = await refundBondBalanceInstruction({
      program,
      configAccount,
      bondAccount: bond.publicKey,
      stakeAccount,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error('failure expected as no excess lamports')
    } catch (e) {
      verifyError(e, Errors, 6083, 'no lamports above the rent-exempt')
    }
  })

  it('cannot refund to stake account not funded to the bond', async () => {
    const nonBondAuthority = Keypair.generate().publicKey
    const stakeAccount = await createDelegatedStakeAccount({
      provider,
      lamports: 2 * LAMPORTS_PER_SOL,
      voteAccount: bond.account.voteAccount,
      withdrawer: nonBondAuthority,
      staker: nonBondAuthority,
    })
    await transferToBond(LAMPORTS_PER_SOL)

    const { instruction } = await refundBondBalanceInstruction({
      program,
      configAccount,
      bondAccount: bond.publicKey,
      stakeAccount,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error('failure expected as stake account is not bond funded')
    } catch (e) {
      verifyError(e, Errors, 6012, 'Wrong withdrawer authority')
    }
  })

  it('cannot refund to settlement funded stake account', async () => {
    const stakeAccount = await createSettlementFundedDelegatedStake({
      program,
      provider,
      configAccount,
      settlementAccount: Keypair.generate().publicKey,
      voteAccount: bond.account.voteAccount,
      lamports: 2 * LAMPORTS_PER_SOL,
    })
    await transferToBond(LAMPORTS_PER_SOL)

    const { instruction } = await refundBondBalanceInstruction({
      program,
      configAccount,
      bondAccount: bond.publicKey,
      stakeAccount,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error('failure expected as funded to settlement')
    } catch (e) {
      verifyError(e, Errors, 6028, 'already funded to a settlement')
    }
  })

  it('cannot refund to stake account delegated to different vote account', async () => {
    const { voteAccount: differentVoteAccount } = await createVoteAccount({
      provider,
    })
    const [bondsAuth] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
    )
    const stakeAccount = await createDelegatedStakeAccount({
      provider,
      lamports: 2 * LAMPORTS_PER_SOL,
      voteAccount: differentVoteAccount,
      withdrawer: bondsAuth,
      staker: bondsAuth,
    })
    await transferToBond(LAMPORTS_PER_SOL)

    const { instruction } = await refundBondBalanceInstruction({
      program,
      configAccount,
      bondAccount: bond.publicKey,
      stakeAccount,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error('failure expected as delegated to wrong validator')
    } catch (e) {
      verifyError(e, Errors, 6020, 'delegated to a wrong validator')
    }
  })

  it('cannot refund to locked stake account', async () => {
    const [bondsAuth] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
    )
    const currentEpoch = Number(provider.getClock().epoch)
    const custodian = Keypair.generate()
    const { stakeAccount, withdrawer } = await delegatedStakeAccount({
      provider,
      lamports: 2 * LAMPORTS_PER_SOL,
      voteAccountToDelegate: bond.account.voteAccount,
      lockup: {
        custodian: custodian.publicKey,
        epoch: currentEpoch + 10,
        unixTimestamp: 0,
      },
    })
    await authorizeStakeAccount({
      provider,
      stakeAccount,
      authority: withdrawer,
      staker: bondsAuth,
      withdrawer: bondsAuth,
      custodian,
    })
    await transferToBond(LAMPORTS_PER_SOL)

    const { instruction } = await refundBondBalanceInstruction({
      program,
      configAccount,
      bondAccount: bond.publicKey,
      stakeAccount,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error('failure expected as stake account is locked')
    } catch (e) {
      verifyError(e, Errors, 6030, 'stake account is locked-up')
    }
  })

  it('cannot refund to deactivated stake account', async () => {
    const [bondsAuth] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
    )
    const { stakeAccount, staker, withdrawer } = await delegatedStakeAccount({
      provider,
      lamports: 2 * LAMPORTS_PER_SOL,
      voteAccountToDelegate: bond.account.voteAccount,
    })
    await warpToNextEpoch(provider)
    const deactivateIx = StakeProgram.deactivate({
      stakePubkey: stakeAccount,
      authorizedPubkey: staker.publicKey,
    })
    await provider.sendIx([provider.wallet, staker], deactivateIx)
    await authorizeStakeAccount({
      provider,
      stakeAccount,
      authority: withdrawer,
      staker: bondsAuth,
      withdrawer: bondsAuth,
    })
    await warpToNextEpoch(provider)
    await transferToBond(LAMPORTS_PER_SOL)

    const { instruction } = await refundBondBalanceInstruction({
      program,
      configAccount,
      bondAccount: bond.publicKey,
      stakeAccount,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error('failure expected as stake account is deactivated')
    } catch (e) {
      verifyError(e, Errors, 6064, 'not activating or activated')
    }
  })

  it('cannot refund when program is paused', async () => {
    const stakeAccount = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      lamports: 2 * LAMPORTS_PER_SOL,
      voteAccount: bond.account.voteAccount,
    })
    await transferToBond(LAMPORTS_PER_SOL)

    const pauseAuthority = Keypair.generate()
    await executeConfigureConfigInstruction({
      program,
      provider,
      configAccount,
      adminAuthority,
      newPauseAuthority: pauseAuthority.publicKey,
    })
    const { instruction: pauseIx } = await emergencyPauseInstruction({
      program,
      configAccount,
      pauseAuthority: pauseAuthority.publicKey,
    })
    await provider.sendIx([pauseAuthority], pauseIx)

    const { instruction } = await refundBondBalanceInstruction({
      program,
      configAccount,
      bondAccount: bond.publicKey,
      stakeAccount,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error('failure expected as program is paused')
    } catch (e) {
      verifyError(e, Errors, 6054, 'Emergency Pause is Active')
    }
  })

  it('refunded amount is claimable through withdraw request', async () => {
    const stakeLamports = 2 * LAMPORTS_PER_SOL
    const excess = 3 * LAMPORTS_PER_SOL
    const stakeAccount = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      lamports: stakeLamports,
      voteAccount: bond.account.voteAccount,
    })
    await transferToBond(excess)

    const { instruction } = await refundBondBalanceInstruction({
      program,
      configAccount,
      bondAccount: bond.publicKey,
      stakeAccount,
    })
    await provider.sendIx([], instruction)
    expect(await lamportsOf(stakeAccount)).toEqual(stakeLamports + excess)

    const { withdrawRequestAccount } =
      await executeInitWithdrawRequestInstruction({
        program,
        provider,
        bondAccount: bond.publicKey,
        configAccount,
        validatorIdentity,
        amount: stakeLamports + excess,
      })
    const withdrawer = Keypair.generate()
    const { instruction: claimIx, splitStakeAccount } =
      await claimWithdrawRequestInstruction({
        program,
        authority: validatorIdentity,
        withdrawRequestAccount,
        bondAccount: bond.publicKey,
        stakeAccount,
        withdrawer: withdrawer.publicKey,
      })
    await warpToNextEpoch(provider)
    await warpToNextEpoch(provider)
    await provider.sendIx([splitStakeAccount, validatorIdentity], claimIx)

    expect(await lamportsOf(stakeAccount)).toEqual(stakeLamports + excess)
    const stakeAccountInfo =
      await provider.connection.getAccountInfo(stakeAccount)
    const stakeAccountData = deserializeStakeState(stakeAccountInfo?.data)
    expect(stakeAccountData.Stake?.meta.authorized.staker).toEqual(
      withdrawer.publicKey,
    )
    expect(stakeAccountData.Stake?.meta.authorized.withdrawer).toEqual(
      withdrawer.publicKey,
    )
  })

  // ----------------------------------------------------------------------
  // Security tests: the instruction is permission-less, the caller picks the
  // stake account and provides all the accounts. Every malformed input has to
  // be rejected with the bond and the target account lamports left untouched.
  // ----------------------------------------------------------------------

  // account order of the refund_bond_balance instruction
  const IX_ACCOUNT_INDEX = {
    config: 0,
    bond: 1,
    bondsWithdrawerAuthority: 2,
    stakeAccount: 3,
    clock: 4,
    stakeHistory: 5,
    rent: 6,
    eventAuthority: 7,
    program: 8,
  }

  async function refundIx(
    stakeAccount: PublicKey,
  ): Promise<TransactionInstruction> {
    const { instruction } = await refundBondBalanceInstruction({
      program,
      configAccount,
      bondAccount: bond.publicKey,
      stakeAccount,
    })
    return instruction
  }

  function replaceIxAccount(
    ix: TransactionInstruction,
    index: number,
    pubkey: PublicKey,
    isWritable?: boolean,
  ): TransactionInstruction {
    const keys = ix.keys.map(k => ({ ...k }))
    const original = keys[index]
    if (original === undefined) {
      throw new Error(`No account at index ${index}`)
    }
    keys[index] = {
      pubkey,
      isSigner: false,
      isWritable: isWritable ?? original.isWritable,
    }
    return new TransactionInstruction({
      programId: ix.programId,
      keys,
      data: ix.data,
    })
  }

  async function delegationOf(address: PublicKey): Promise<string> {
    const info = await provider.connection.getAccountInfo(address)
    const state = deserializeStakeState(info?.data)
    return state.Stake?.stake.delegation.stake.toString() ?? 'not-delegated'
  }

  /** Transaction has to fail with the expected error and no lamports may move. */
  async function expectRejected(
    ixs: TransactionInstruction | TransactionInstruction[],
    target: PublicKey | undefined,
    expectedError: string,
  ) {
    const getLamports = async (address: PublicKey) =>
      (await provider.connection.getAccountInfo(address))?.lamports ?? 0
    const bondBefore = await getLamports(bond.publicKey)
    const targetBefore = target ? await getLamports(target) : 0
    let errorInfo: string | undefined
    try {
      await provider.sendIx([], ...(Array.isArray(ixs) ? ixs : [ixs]))
    } catch (e) {
      const err = e as { message?: string; logs?: string[] }
      errorInfo = `${err.message ?? ''} ${(err.logs ?? []).join(' ')}`
    }
    expect(errorInfo).toBeDefined()
    expect(errorInfo).toContain(expectedError)
    expect(await getLamports(bond.publicKey)).toEqual(bondBefore)
    if (target) {
      expect(await getLamports(target)).toEqual(targetBefore)
    }
  }

  it('cannot refund to stake account of a different config', async () => {
    const { configAccount: otherConfig } = await executeInitConfigInstruction({
      program,
      provider,
    })
    const [otherBondsAuth] = bondsWithdrawerAuthority(
      otherConfig,
      program.programId,
    )
    const stakeAccount = await createDelegatedStakeAccount({
      provider,
      lamports: 2 * LAMPORTS_PER_SOL,
      voteAccount: bond.account.voteAccount,
      withdrawer: otherBondsAuth,
      staker: otherBondsAuth,
    })
    await transferToBond(LAMPORTS_PER_SOL)

    const ix = await refundIx(stakeAccount)
    await expectRejected(ix, stakeAccount, 'WrongStakeAccountWithdrawer')
    // foreign bonds withdrawer authority PDA passed in
    await expectRejected(
      replaceIxAccount(
        ix,
        IX_ACCOUNT_INDEX.bondsWithdrawerAuthority,
        otherBondsAuth,
      ),
      stakeAccount,
      'ConstraintSeeds',
    )
    // foreign config together with its authority, bond of the original config
    await expectRejected(
      replaceIxAccount(
        replaceIxAccount(ix, IX_ACCOUNT_INDEX.config, otherConfig),
        IX_ACCOUNT_INDEX.bondsWithdrawerAuthority,
        otherBondsAuth,
      ),
      stakeAccount,
      'ConstraintSeeds',
    )
  })

  it('cannot refund with partially matching stake authorities', async () => {
    const [bondsAuth] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
    )
    const stranger = Keypair.generate().publicKey
    await transferToBond(LAMPORTS_PER_SOL)

    const strangerStaker = await createDelegatedStakeAccount({
      provider,
      lamports: 2 * LAMPORTS_PER_SOL,
      voteAccount: bond.account.voteAccount,
      withdrawer: bondsAuth,
      staker: stranger,
    })
    await expectRejected(
      await refundIx(strangerStaker),
      strangerStaker,
      'StakeAccountIsFundedToSettlement',
    )

    const strangerWithdrawer = await createDelegatedStakeAccount({
      provider,
      lamports: 2 * LAMPORTS_PER_SOL,
      voteAccount: bond.account.voteAccount,
      withdrawer: stranger,
      staker: bondsAuth,
    })
    await expectRejected(
      await refundIx(strangerWithdrawer),
      strangerWithdrawer,
      'WrongStakeAccountWithdrawer',
    )

    // the caller cannot substitute the bonds withdrawer authority
    const strangerOwned = await createDelegatedStakeAccount({
      provider,
      lamports: 2 * LAMPORTS_PER_SOL,
      voteAccount: bond.account.voteAccount,
      withdrawer: stranger,
      staker: stranger,
    })
    await expectRejected(
      replaceIxAccount(
        await refundIx(strangerOwned),
        IX_ACCOUNT_INDEX.bondsWithdrawerAuthority,
        stranger,
      ),
      strangerOwned,
      'ConstraintSeeds',
    )
  })

  it('cannot refund to not delegated, deactivating or uninitialized stake account', async () => {
    const [bondsAuth] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
    )
    await transferToBond(LAMPORTS_PER_SOL)

    const { stakeAccount: initializedOnly } =
      await createInitializedStakeAccount({
        provider,
        staker: bondsAuth,
        withdrawer: bondsAuth,
      })
    await expectRejected(
      await refundIx(initializedOnly),
      initializedOnly,
      'StakeNotDelegated',
    )

    // delegated and deactivated within the same epoch
    const {
      stakeAccount: sameEpoch,
      staker: sameEpochStaker,
      withdrawer: sameEpochWithdrawer,
    } = await delegatedStakeAccount({
      provider,
      lamports: 2 * LAMPORTS_PER_SOL,
      voteAccountToDelegate: bond.account.voteAccount,
    })
    await provider.sendIx(
      [sameEpochStaker],
      StakeProgram.deactivate({
        stakePubkey: sameEpoch,
        authorizedPubkey: sameEpochStaker.publicKey,
      }),
    )
    await authorizeStakeAccount({
      provider,
      stakeAccount: sameEpoch,
      authority: sameEpochWithdrawer,
      staker: bondsAuth,
      withdrawer: bondsAuth,
    })
    await expectRejected(
      await refundIx(sameEpoch),
      sameEpoch,
      'NoStakeOrNotActivatingOrActivated',
    )

    // activated and deactivated in the current epoch, still cooling down
    const {
      stakeAccount: deactivating,
      staker,
      withdrawer,
    } = await delegatedStakeAccount({
      provider,
      lamports: 2 * LAMPORTS_PER_SOL,
      voteAccountToDelegate: bond.account.voteAccount,
    })
    await warpToNextEpoch(provider)
    await provider.sendIx(
      [staker],
      StakeProgram.deactivate({
        stakePubkey: deactivating,
        authorizedPubkey: staker.publicKey,
      }),
    )
    await authorizeStakeAccount({
      provider,
      stakeAccount: deactivating,
      authority: withdrawer,
      staker: bondsAuth,
      withdrawer: bondsAuth,
    })
    await expectRejected(
      await refundIx(deactivating),
      deactivating,
      'NoStakeOrNotActivatingOrActivated',
    )

    // account owned by the stake program that was never initialized
    const uninitialized = Keypair.generate()
    await provider.sendIx(
      [uninitialized],
      SystemProgram.createAccount({
        fromPubkey: provider.walletPubkey,
        newAccountPubkey: uninitialized.publicKey,
        lamports: 2 * LAMPORTS_PER_SOL,
        space: StakeProgram.space,
        programId: StakeProgram.programId,
      }),
    )
    await expectRejected(
      await refundIx(uninitialized.publicKey),
      uninitialized.publicKey,
      'UninitializedStake',
    )
  })

  it('cannot refund to account not owned by stake program', async () => {
    const stakeAccount = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      lamports: 2 * LAMPORTS_PER_SOL,
      voteAccount: bond.account.voteAccount,
    })
    await transferToBond(LAMPORTS_PER_SOL)
    const stakeInfo = await provider.connection.getAccountInfo(stakeAccount)
    expect(stakeInfo).not.toBeNull()

    // byte-exact copy of a valid bond stake account owned by a wrong program
    for (const owner of [
      SystemProgram.programId,
      program.programId,
      Keypair.generate().publicKey,
    ]) {
      const fakeStake = Keypair.generate().publicKey
      provider.setAccount(fakeStake, {
        lamports: stakeInfo!.lamports,
        data: stakeInfo!.data,
        owner,
        executable: false,
      })
      await expectRejected(
        await refundIx(fakeStake),
        fakeStake,
        'AccountOwnedByWrongProgram',
      )
    }

    const ix = await refundIx(stakeAccount)
    // bond account used as the stake account
    await expectRejected(
      await refundIx(bond.publicKey),
      undefined,
      'AccountOwnedByWrongProgram',
    )
    // stake account used as the bond account
    await expectRejected(
      replaceIxAccount(ix, IX_ACCOUNT_INDEX.bond, stakeAccount),
      stakeAccount,
      'AccountOwnedByWrongProgram',
    )
    await expectRejected(
      await refundIx(bond.account.voteAccount),
      bond.account.voteAccount,
      'AccountOwnedByWrongProgram',
    )
    // accounts have to be writable
    await expectRejected(
      replaceIxAccount(ix, IX_ACCOUNT_INDEX.stakeAccount, stakeAccount, false),
      stakeAccount,
      'ConstraintMut',
    )
    await expectRejected(
      replaceIxAccount(ix, IX_ACCOUNT_INDEX.bond, bond.publicKey, false),
      stakeAccount,
      'ConstraintMut',
    )
  })

  it('cannot refund with forged sysvar accounts', async () => {
    const sysvarOwner = new PublicKey(
      'Sysvar1111111111111111111111111111111111111',
    )
    const stakeAccount = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      lamports: 2 * LAMPORTS_PER_SOL,
      voteAccount: bond.account.voteAccount,
    })
    await transferToBond(LAMPORTS_PER_SOL)
    const ix = await refundIx(stakeAccount)

    // rent with zero lamports per byte would let the bond be drained to zero
    const rentInfo =
      await provider.connection.getAccountInfo(SYSVAR_RENT_PUBKEY)
    expect(rentInfo).not.toBeNull()
    const forgedRentData = Buffer.from(rentInfo!.data)
    forgedRentData.writeBigUInt64LE(0n, 0)
    for (const owner of [sysvarOwner, SystemProgram.programId]) {
      const forgedRent = Keypair.generate().publicKey
      provider.setAccount(forgedRent, {
        lamports: rentInfo!.lamports,
        data: forgedRentData,
        owner,
        executable: false,
      })
      await expectRejected(
        replaceIxAccount(ix, IX_ACCOUNT_INDEX.rent, forgedRent),
        stakeAccount,
        'AccountSysvarMismatch',
      )
    }

    const clockInfo =
      await provider.connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY)
    expect(clockInfo).not.toBeNull()
    const forgedClockData = Buffer.from(clockInfo!.data)
    forgedClockData.writeBigUInt64LE(1n, 16) // epoch
    const forgedClock = Keypair.generate().publicKey
    provider.setAccount(forgedClock, {
      lamports: clockInfo!.lamports,
      data: forgedClockData,
      owner: sysvarOwner,
      executable: false,
    })
    await expectRejected(
      replaceIxAccount(ix, IX_ACCOUNT_INDEX.clock, forgedClock),
      stakeAccount,
      'AccountSysvarMismatch',
    )

    const stakeHistoryInfo = await provider.connection.getAccountInfo(
      SYSVAR_STAKE_HISTORY_PUBKEY,
    )
    expect(stakeHistoryInfo).not.toBeNull()
    const forgedStakeHistory = Keypair.generate().publicKey
    provider.setAccount(forgedStakeHistory, {
      lamports: stakeHistoryInfo!.lamports,
      data: Buffer.alloc(8),
      owner: sysvarOwner,
      executable: false,
    })
    await expectRejected(
      replaceIxAccount(ix, IX_ACCOUNT_INDEX.stakeHistory, forgedStakeHistory),
      stakeAccount,
      'AccountSysvarMismatch',
    )

    // real sysvars passed in swapped positions
    await expectRejected(
      replaceIxAccount(
        replaceIxAccount(ix, IX_ACCOUNT_INDEX.clock, SYSVAR_RENT_PUBKEY),
        IX_ACCOUNT_INDEX.rent,
        SYSVAR_CLOCK_PUBKEY,
      ),
      stakeAccount,
      'AccountSysvarMismatch',
    )
  })

  it('cannot refund with forged event authority or program account', async () => {
    const stakeAccount = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      lamports: 2 * LAMPORTS_PER_SOL,
      voteAccount: bond.account.voteAccount,
    })
    await transferToBond(LAMPORTS_PER_SOL)
    const ix = await refundIx(stakeAccount)

    await expectRejected(
      replaceIxAccount(
        ix,
        IX_ACCOUNT_INDEX.eventAuthority,
        Keypair.generate().publicKey,
      ),
      stakeAccount,
      'ConstraintAddress',
    )
    await expectRejected(
      replaceIxAccount(ix, IX_ACCOUNT_INDEX.program, StakeProgram.programId),
      stakeAccount,
      'Unknown program',
    )
  })

  it('bond account stays rent exempt and refund is atomic', async () => {
    const stakeLamports = 3 * LAMPORTS_PER_SOL
    const excess = 7 * LAMPORTS_PER_SOL
    const stakeAccount = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      lamports: stakeLamports,
      voteAccount: bond.account.voteAccount,
    })
    await transferToBond(excess)
    const rentExempt = await bondRentExempt()
    const delegationBefore = await delegationOf(stakeAccount)

    // second refund in the same transaction has nothing to move,
    // whole transaction is reverted
    await expectRejected(
      [await refundIx(stakeAccount), await refundIx(stakeAccount)],
      stakeAccount,
      'RefundBondBalanceNoExcessLamports',
    )

    await provider.sendIx([], await refundIx(stakeAccount))
    expect(await lamportsOf(bond.publicKey)).toEqual(rentExempt)
    expect(await lamportsOf(stakeAccount)).toEqual(stakeLamports + excess)
    // refunded lamports are not delegated, they sit at the stake account as free lamports
    expect(await delegationOf(stakeAccount)).toEqual(delegationBefore)

    await expectRejected(
      await refundIx(stakeAccount),
      stakeAccount,
      'RefundBondBalanceNoExcessLamports',
    )

    // one lamport above rent exempt is refundable
    await transferToBond(1)
    await provider.sendIx([], await refundIx(stakeAccount))
    expect(await lamportsOf(bond.publicKey)).toEqual(rentExempt)
    expect(await lamportsOf(stakeAccount)).toEqual(stakeLamports + excess + 1)

    // bond below rent exempt (not reachable on chain, forced here) is not touched
    const bondInfo = await provider.connection.getAccountInfo(bond.publicKey)
    expect(bondInfo).not.toBeNull()
    provider.setAccount(bond.publicKey, {
      ...bondInfo!,
      lamports: rentExempt - 1000,
    })
    await expectRejected(
      await refundIx(stakeAccount),
      stakeAccount,
      'RefundBondBalanceNoExcessLamports',
    )
  })

  it('refund to stake account with expired lockup', async () => {
    const [bondsAuth] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
    )
    const currentEpoch = Number(provider.getClock().epoch)
    const custodian = Keypair.generate()
    const { stakeAccount, withdrawer } = await delegatedStakeAccount({
      provider,
      lamports: 2 * LAMPORTS_PER_SOL,
      voteAccountToDelegate: bond.account.voteAccount,
      lockup: {
        custodian: custodian.publicKey,
        epoch: currentEpoch + 2,
        unixTimestamp: 0,
      },
    })
    await authorizeStakeAccount({
      provider,
      stakeAccount,
      authority: withdrawer,
      staker: bondsAuth,
      withdrawer: bondsAuth,
      custodian,
    })
    await transferToBond(LAMPORTS_PER_SOL)
    await expectRejected(
      await refundIx(stakeAccount),
      stakeAccount,
      'StakeLockedUp',
    )

    await warpToNextEpoch(provider)
    await warpToNextEpoch(provider)
    await warpToNextEpoch(provider)
    await provider.sendIx([], await refundIx(stakeAccount))
    expect(await lamportsOf(bond.publicKey)).toEqual(await bondRentExempt())
    expect(await lamportsOf(stakeAccount)).toEqual(3 * LAMPORTS_PER_SOL)
  })

  // Refunded lamports are free (not delegated) lamports of the stake account.
  // Stake program split moves only delegated lamports and the split-off account
  // needs to keep the minimum delegation (1 SOL). All refunded lamports stay
  // with the claimed account, thus a partial claim has to cover them.
  async function claimPartialWithdraw(
    withdrawLamports: number,
    refundedLamports: number,
    stakeLamports: number,
  ) {
    const stakeAccount = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      lamports: stakeLamports,
      voteAccount: bond.account.voteAccount,
    })
    await transferToBond(refundedLamports)
    await provider.sendIx([], await refundIx(stakeAccount))

    const { withdrawRequestAccount } =
      await executeInitWithdrawRequestInstruction({
        program,
        provider,
        bondAccount: bond.publicKey,
        configAccount,
        validatorIdentity,
        amount: withdrawLamports,
      })
    const { instruction: claimIx, splitStakeAccount } =
      await claimWithdrawRequestInstruction({
        program,
        authority: validatorIdentity,
        withdrawRequestAccount,
        bondAccount: bond.publicKey,
        stakeAccount,
        withdrawer: Keypair.generate().publicKey,
      })
    await warpToNextEpoch(provider)
    await warpToNextEpoch(provider)
    return {
      stakeAccount,
      splitStakeAccount,
      claim: () =>
        provider.sendIx([splitStakeAccount, validatorIdentity], claimIx),
    }
  }

  it.each([20, 31])(
    'cannot partially withdraw %d SOL from stake account with 30 SOL refunded',
    async withdrawSol => {
      const stakeLamports = 100 * LAMPORTS_PER_SOL
      const refunded = 30 * LAMPORTS_PER_SOL
      const { stakeAccount, claim } = await claimPartialWithdraw(
        withdrawSol * LAMPORTS_PER_SOL,
        refunded,
        stakeLamports,
      )
      // stake program error InsufficientDelegation
      await expect(claim()).rejects.toMatchObject({
        logs: expect.arrayContaining([
          expect.stringContaining('custom program error: 0xc'),
        ]),
      })
      expect(await lamportsOf(stakeAccount)).toEqual(stakeLamports + refunded)
    },
  )

  it('partial withdraw covering refunded lamports', async () => {
    const stakeLamports = 100 * LAMPORTS_PER_SOL
    const refunded = 30 * LAMPORTS_PER_SOL
    const withdrawLamports = 32 * LAMPORTS_PER_SOL
    const { stakeAccount, splitStakeAccount, claim } =
      await claimPartialWithdraw(withdrawLamports, refunded, stakeLamports)
    await claim()
    // claimed account takes all the refunded (not delegated) lamports
    expect(await lamportsOf(stakeAccount)).toEqual(withdrawLamports)
    expect(
      await lamportsOf(splitStakeAccount.publicKey),
    ).toBeGreaterThanOrEqual(stakeLamports + refunded - withdrawLamports)
  })
})
