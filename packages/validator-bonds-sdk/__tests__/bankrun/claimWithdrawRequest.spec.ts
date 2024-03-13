import {
  Bond,
  Errors,
  ValidatorBondsProgram,
  cancelWithdrawRequestInstruction,
  getBond,
  getWithdrawRequest,
  settlementStakerAuthority,
  bondsWithdrawerAuthority,
  deserializeStakeState,
} from '../../src'
import {
  BankrunExtendedProvider,
  assertNotExist,
  delegateAndFund,
  initBankrunTest,
  warpOffsetEpoch,
  warpToEpoch,
  warpToNextEpoch,
} from './bankrun'
import {
  createUserAndFund,
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitWithdrawRequestInstruction,
} from '../utils/testTransactions'
import { ProgramAccount } from '@coral-xyz/anchor'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { claimWithdrawRequestInstruction } from '../../src/instructions/claimWithdrawRequest'
import {
  authorizeStakeAccount,
  delegatedStakeAccount,
  createInitializedStakeAccount,
} from '../utils/staking'
import assert from 'assert'
import BN from 'bn.js'
import { pubkey, signer } from '@marinade.finance/web3js-common'
import { verifyError } from '@marinade.finance/anchor-common'

// TODO: test the merging stake accounts through the orchestrate withdraw request, i.e., test orchestrators/orchestrateWithdrawRequest.ts

describe('Validator Bonds claim withdraw request', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let bond: ProgramAccount<Bond>
  let validatorIdentity: Keypair
  let bondAuthority: Keypair
  let voteAccount: PublicKey
  const startUpEpoch = Math.floor(Math.random() * 100) + 100
  const withdrawLockupEpochs = 1

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
    warpToEpoch(provider, startUpEpoch)
  })

  beforeEach(async () => {
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
      withdrawLockupEpochs,
    }))
    const {
      bondAccount,
      validatorIdentity: nodeIdentity,
      voteAccount: voteAcc,
      bondAuthority: bondAuth,
    } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
    })
    voteAccount = voteAcc
    bondAuthority = bondAuth
    validatorIdentity = nodeIdentity!
    bond = {
      publicKey: bondAccount,
      account: await getBond(program, bondAccount),
    }
  })

  it('claim withdraw request with split stake account created', async () => {
    const epochAtTestStart = Number(
      (await provider.context.banksClient.getClock()).epoch
    )

    const initAmount = 5 * LAMPORTS_PER_SOL
    const requestedAmount = LAMPORTS_PER_SOL * 2
    const { withdrawRequest, stakeAccount } =
      await createStakeAccountAndInitWithdraw(initAmount, requestedAmount)

    let withdrawRequestData = await getWithdrawRequest(program, withdrawRequest)
    expect(withdrawRequestData.voteAccount).toEqual(voteAccount)
    expect(withdrawRequestData.withdrawnAmount).toEqual(0)
    expect(withdrawRequestData.requestedAmount).toEqual(requestedAmount)

    const { instruction, splitStakeAccount } =
      await claimWithdrawRequestInstruction({
        program,
        authority: validatorIdentity,
        withdrawRequestAccount: withdrawRequest,
        bondAccount: bond.publicKey,
        stakeAccount,
      })

    // waiting an epoch but not enough to unlock
    await warpToNextEpoch(provider)
    try {
      await provider.sendIx([splitStakeAccount, validatorIdentity], instruction)
      throw new Error('Expected withdraw request should not be elapsed')
    } catch (err) {
      verifyError(err, Errors, 6021, 'Withdraw request has not elapsed')
    }

    // withdrawLockupEpochs is 1, then the warp should make the withdraw request unlocked
    await warpToNextEpoch(provider)
    await provider.sendIx([splitStakeAccount, validatorIdentity], instruction)

    // withdraw request exists until is cancelled
    withdrawRequestData = await getWithdrawRequest(program, withdrawRequest)
    expect(withdrawRequestData.withdrawnAmount).toEqual(requestedAmount)
    expect(withdrawRequestData.requestedAmount).toEqual(requestedAmount)

    const originalStakeAccountInfo =
      await provider.connection.getAccountInfo(stakeAccount)
    expect(originalStakeAccountInfo?.lamports).toEqual(requestedAmount)

    assert(
      originalStakeAccountInfo !== null,
      'original stake account not found'
    )
    const rentExemptStakeAccount =
      await provider.connection.getMinimumBalanceForRentExemption(
        originalStakeAccountInfo.data.length
      )
    console.log('rentExemptStakeAccount', rentExemptStakeAccount)

    // -------- ORIGINAL STAKE ACCOUNT --------
    const originalStakeAccountData = deserializeStakeState(
      originalStakeAccountInfo.data
    )
    expect(originalStakeAccountData.Stake?.meta.authorized.staker).toEqual(
      validatorIdentity.publicKey
    )
    expect(originalStakeAccountData.Stake?.meta.authorized.withdrawer).toEqual(
      validatorIdentity.publicKey
    )
    expect(originalStakeAccountData.Stake?.meta.lockup.epoch).toEqual(0)
    expect(originalStakeAccountData.Stake?.meta.lockup.unixTimestamp).toEqual(0)
    expect(originalStakeAccountData.Stake?.meta.rentExemptReserve).toEqual(
      rentExemptStakeAccount
    )
    expect(originalStakeAccountData.Stake?.stake.delegation.stake).toEqual(
      requestedAmount - rentExemptStakeAccount
    )
    expect(
      originalStakeAccountData.Stake?.stake.delegation.voterPubkey
    ).toEqual(voteAccount)
    expect(
      originalStakeAccountData.Stake?.stake.delegation.activationEpoch.toNumber()
    ).toEqual(epochAtTestStart)
    expect(
      new BN(
        originalStakeAccountData.Stake!.stake.delegation.deactivationEpoch.toString()
      ).gt(new BN(epochAtTestStart))
    ).toBeTruthy()

    // -------- SPLIT STAKE ACCOUNT --------
    const splitStakeAccountInfo = await provider.connection.getAccountInfo(
      splitStakeAccount.publicKey
    )
    expect(splitStakeAccountInfo).not.toBeNull()
    expect(splitStakeAccountInfo?.lamports).toEqual(
      initAmount - requestedAmount + rentExemptStakeAccount
    )
    assert(splitStakeAccountInfo !== null, 'split stake account not found')

    const [bondsAuthority] = bondsWithdrawerAuthority(
      configAccount,
      program.programId
    )
    const splitStakeAccountData = deserializeStakeState(
      splitStakeAccountInfo?.data
    )
    expect(splitStakeAccountData.Stake?.meta.authorized.withdrawer).toEqual(
      bondsAuthority
    )
    expect(splitStakeAccountData.Stake?.meta.authorized.staker).toEqual(
      bondsAuthority
    )
    expect(splitStakeAccountData.Stake?.meta.lockup.epoch).toEqual(0)
    expect(splitStakeAccountData.Stake?.meta.lockup.unixTimestamp).toEqual(0)
    expect(splitStakeAccountData.Stake?.meta.rentExemptReserve).toEqual(
      rentExemptStakeAccount
    )
    expect(splitStakeAccountData.Stake?.stake.delegation.stake).toEqual(
      initAmount - requestedAmount
    )
    expect(splitStakeAccountData.Stake?.stake.delegation.voterPubkey).toEqual(
      voteAccount
    )
    expect(
      splitStakeAccountData.Stake?.stake.delegation.activationEpoch.toNumber()
    ).toEqual(epochAtTestStart)
    expect(
      new BN(
        splitStakeAccountData.Stake!.stake.delegation.deactivationEpoch.toString()
      ).gt(new BN(epochAtTestStart))
    ).toBeTruthy()
  })

  it('claim withdraw request with stake fulfilling the whole', async () => {
    const epochAtTestStart = Number(
      (await provider.context.banksClient.getClock()).epoch
    )

    const requestedAmount = 2 * LAMPORTS_PER_SOL
    const { withdrawRequest, stakeAccount } =
      await createStakeAccountAndInitWithdraw(requestedAmount, requestedAmount)

    const { instruction, splitStakeAccount } =
      await claimWithdrawRequestInstruction({
        program,
        authority: validatorIdentity,
        withdrawRequestAccount: withdrawRequest,
        bondAccount: bond.publicKey,
        stakeAccount,
      })

    await warpToUnlockClaiming()
    await provider.sendIx([splitStakeAccount, validatorIdentity], instruction)

    // withdraw request exists until is cancelled
    const withdrawRequestData = await getWithdrawRequest(
      program,
      withdrawRequest
    )
    expect(withdrawRequestData.withdrawnAmount).toEqual(requestedAmount)
    expect(withdrawRequestData.requestedAmount).toEqual(requestedAmount)

    const originalStakeAccountInfo =
      await provider.connection.getAccountInfo(stakeAccount)
    expect(originalStakeAccountInfo?.lamports).toEqual(requestedAmount)

    assert(
      originalStakeAccountInfo !== null,
      'original stake account not found'
    )
    const rentExemptStakeAccount =
      await provider.connection.getMinimumBalanceForRentExemption(
        originalStakeAccountInfo.data.length
      )

    // -------- ORIGINAL STAKE ACCOUNT --------
    const originalStakeAccountData = deserializeStakeState(
      originalStakeAccountInfo.data
    )
    expect(originalStakeAccountData.Stake?.meta.authorized.staker).toEqual(
      validatorIdentity.publicKey
    )
    expect(originalStakeAccountData.Stake?.meta.authorized.withdrawer).toEqual(
      validatorIdentity.publicKey
    )
    expect(originalStakeAccountData.Stake?.meta.lockup.epoch).toEqual(0)
    expect(originalStakeAccountData.Stake?.meta.lockup.unixTimestamp).toEqual(0)
    expect(originalStakeAccountData.Stake?.meta.rentExemptReserve).toEqual(
      rentExemptStakeAccount
    )
    expect(originalStakeAccountData.Stake?.stake.delegation.stake).toEqual(
      requestedAmount - rentExemptStakeAccount
    )
    expect(
      originalStakeAccountData.Stake?.stake.delegation.voterPubkey
    ).toEqual(voteAccount)
    expect(
      originalStakeAccountData.Stake?.stake.delegation.activationEpoch.toNumber()
    ).toEqual(epochAtTestStart)
    expect(
      new BN(
        originalStakeAccountData.Stake!.stake.delegation.deactivationEpoch.toString()
      ).gt(new BN(epochAtTestStart))
    ).toBeTruthy()
    // -------- SPLIT STAKE ACCOUNT --------
    await assertNotExist(provider, splitStakeAccount.publicKey)

    // double claiming the withdraw request should fail
    await warpToNextEpoch(provider)
    try {
      await provider.sendIx([splitStakeAccount, validatorIdentity], instruction)
      throw new Error('failure expected; already claimed')
    } catch (err) {
      verifyError(err, Errors, 6049, 'already fulfilled')
    }
  })

  it('claim withdraw with full SDK usage', async () => {
    const requestedAmount = 2 * LAMPORTS_PER_SOL
    const stakeAccountAmount = 20 * LAMPORTS_PER_SOL
    const { withdrawRequest, stakeAccount } =
      await createStakeAccountAndInitWithdraw(
        stakeAccountAmount,
        requestedAmount
      )
    const rentPayerUser = await createUserAndFund(provider, LAMPORTS_PER_SOL)
    const withdrawer = await createUserAndFund(provider, LAMPORTS_PER_SOL)
    const { instruction, splitStakeAccount } =
      await claimWithdrawRequestInstruction({
        program,
        authority: bondAuthority,
        withdrawRequestAccount: withdrawRequest,
        bondAccount: bond.publicKey,
        stakeAccount,
        configAccount,
        splitStakeRentPayer: rentPayerUser,
        voteAccount,
        withdrawer: pubkey(withdrawer),
      })
    await warpToUnlockClaiming()
    await provider.sendIx(
      [splitStakeAccount, signer(rentPayerUser), bondAuthority],
      instruction
    )

    const originalStakeAccountInfo =
      await provider.connection.getAccountInfo(stakeAccount)
    expect(originalStakeAccountInfo?.lamports).toEqual(requestedAmount)
    assert(originalStakeAccountInfo !== null)
    const originalStakeAccountData = deserializeStakeState(
      originalStakeAccountInfo.data
    )
    expect(originalStakeAccountData.Stake?.meta.authorized.staker).toEqual(
      pubkey(withdrawer)
    )
    expect(originalStakeAccountData.Stake?.meta.authorized.withdrawer).toEqual(
      pubkey(withdrawer)
    )
    const splitStakeAccountInfo = await provider.connection.getAccountInfo(
      splitStakeAccount.publicKey
    )
    expect(splitStakeAccountInfo).not.toBeNull()
    assert(splitStakeAccountInfo !== null, 'split stake account not found')
    const rentExemptStakeAccount =
      await provider.connection.getMinimumBalanceForRentExemption(
        splitStakeAccountInfo.data.length
      )
    expect(
      (await provider.connection.getAccountInfo(pubkey(rentPayerUser)))
        ?.lamports
    ).toEqual(LAMPORTS_PER_SOL - rentExemptStakeAccount)
  })

  it('fail to claim on wrong split size amount', async () => {
    const requestedAmount = 321 * LAMPORTS_PER_SOL
    const stakeAmount = 320 * LAMPORTS_PER_SOL
    const { withdrawRequest, stakeAccount } =
      await createStakeAccountAndInitWithdraw(stakeAmount, requestedAmount)
    const { stakeAccount: stakeAccountCannotSplit } = await delegateAndFund({
      program,
      provider,
      lamports: 2 * LAMPORTS_PER_SOL,
      voteAccount,
      bondAccount: bond.publicKey,
    })
    const { stakeAccount: stakeAccountCannotSplit2 } = await delegateAndFund({
      program,
      provider,
      lamports: 3 * LAMPORTS_PER_SOL,
      voteAccount,
      bondAccount: bond.publicKey,
    })
    await warpToUnlockClaiming()

    // partially fulfill
    const { instruction: ix1, splitStakeAccount: split1 } =
      await claimWithdrawRequestInstruction({
        program,
        authority: validatorIdentity,
        withdrawRequestAccount: withdrawRequest,
        stakeAccount,
      })
    await provider.sendIx([split1, validatorIdentity], ix1)

    const { instruction: ixCannotSplit, splitStakeAccount: splitCannotSplit } =
      await claimWithdrawRequestInstruction({
        program,
        authority: bondAuthority,
        withdrawRequestAccount: withdrawRequest,
        stakeAccount: stakeAccountCannotSplit,
      })
    try {
      await provider.sendIx([splitCannotSplit, bondAuthority], ixCannotSplit)
      throw new Error('failure expected; cannot split')
    } catch (err) {
      verifyError(err, Errors, 6031, 'Stake account is not big enough')
    }

    const {
      instruction: ixCannotSplit2,
      splitStakeAccount: splitCannotSplit2,
    } = await claimWithdrawRequestInstruction({
      program,
      authority: validatorIdentity,
      withdrawRequestAccount: withdrawRequest,
      stakeAccount: stakeAccountCannotSplit2,
    })
    try {
      await provider.sendIx(
        [splitCannotSplit2, validatorIdentity],
        ixCannotSplit2
      )
      throw new Error('failure expected; cannot split')
    } catch (err) {
      verifyError(err, Errors, 6048, 'cancel and init new one')
    }
  })

  it('fail to claim when split is less to 1 SOL', async () => {
    const { withdrawRequest, stakeAccount } =
      await createStakeAccountAndInitWithdraw(
        4 * LAMPORTS_PER_SOL,
        LAMPORTS_PER_SOL * 3
      )

    const { instruction, splitStakeAccount } =
      await claimWithdrawRequestInstruction({
        program,
        authority: validatorIdentity,
        withdrawRequestAccount: withdrawRequest,
        bondAccount: bond.publicKey,
        stakeAccount,
      })

    await warpToUnlockClaiming()
    try {
      await provider.sendIx([splitStakeAccount, validatorIdentity], instruction)
      throw new Error('is less to 1 SOL: should fail as  split is not possible')
    } catch (err) {
      verifyError(err, Errors, 6031, 'not big enough to be split')
    }
  })

  it('claim more different stake accounts and cancel', async () => {
    const requestedAmount = 10 * LAMPORTS_PER_SOL
    const stake1Amount = 2 * LAMPORTS_PER_SOL
    const stake2Amount = 3 * LAMPORTS_PER_SOL
    const stake3Amount = 1.5 * LAMPORTS_PER_SOL
    const { withdrawRequest, stakeAccount: stakeAccount1 } =
      await createStakeAccountAndInitWithdraw(stake1Amount, requestedAmount)
    const { stakeAccount: stakeAccount2 } = await delegateAndFund({
      program,
      provider,
      lamports: stake2Amount,
      voteAccount,
      bondAccount: bond.publicKey,
    })
    const { stakeAccount: stakeAccount3 } = await delegateAndFund({
      program,
      provider,
      lamports: stake3Amount,
      voteAccount,
      bondAccount: bond.publicKey,
    })

    const { instruction: ix1, splitStakeAccount: split1 } =
      await claimWithdrawRequestInstruction({
        program,
        authority: validatorIdentity,
        withdrawRequestAccount: withdrawRequest,
        bondAccount: bond.publicKey,
        stakeAccount: stakeAccount1,
      })
    const { instruction: ix2, splitStakeAccount: split2 } =
      await claimWithdrawRequestInstruction({
        program,
        authority: validatorIdentity,
        withdrawRequestAccount: withdrawRequest,
        bondAccount: bond.publicKey,
        stakeAccount: stakeAccount2,
      })
    const { instruction: ix3, splitStakeAccount: split3 } =
      await claimWithdrawRequestInstruction({
        program,
        authority: validatorIdentity,
        withdrawRequestAccount: withdrawRequest,
        bondAccount: bond.publicKey,
        stakeAccount: stakeAccount3,
      })

    await warpToUnlockClaiming()
    await provider.sendIx(
      [split1, split2, split3, validatorIdentity],
      ix1,
      ix2,
      ix3
    )
    const withdrawRequestData = await getWithdrawRequest(
      program,
      withdrawRequest
    )
    expect(withdrawRequestData.requestedAmount).toEqual(requestedAmount)
    expect(withdrawRequestData.withdrawnAmount).toEqual(
      stake1Amount + stake2Amount + stake3Amount
    )

    const { instruction: cancelIx } = await cancelWithdrawRequestInstruction({
      program,
      withdrawRequestAccount: withdrawRequest,
      bondAccount: bond.publicKey,
      authority: validatorIdentity,
    })
    await provider.sendIx([validatorIdentity], cancelIx)
    await assertNotExist(provider, withdrawRequest)
  })

  it('cannot claim with wrong bonds authority', async () => {
    const wrongAuthority = Keypair.generate()
    const { stakeAccount, withdrawRequest } =
      await createStakeAccountAndInitWithdraw(
        2 * LAMPORTS_PER_SOL,
        10 * LAMPORTS_PER_SOL
      )
    await warpToUnlockClaiming()
    const { instruction, splitStakeAccount } =
      await claimWithdrawRequestInstruction({
        program,
        authority: wrongAuthority.publicKey,
        withdrawRequestAccount: withdrawRequest,
        stakeAccount,
      })

    try {
      await provider.sendIx([splitStakeAccount, wrongAuthority], instruction)
      throw new Error('failure expected; wrong authority to claim')
    } catch (e) {
      verifyError(e, Errors, 6002, 'Invalid authority to operate')
    }
  })

  it('cannot claim with non-delegated stake account', async () => {
    const { stakeAccount: nonDelegatedStakeAccount } =
      await createInitializedStakeAccount({ provider })
    const { withdrawRequest } = await initWithdrawRequest(2 * LAMPORTS_PER_SOL)
    await warpToUnlockClaiming()
    const { instruction, splitStakeAccount } =
      await claimWithdrawRequestInstruction({
        program,
        authority: validatorIdentity,
        withdrawRequestAccount: withdrawRequest,
        bondAccount: bond.publicKey,
        stakeAccount: nonDelegatedStakeAccount,
      })

    try {
      await provider.sendIx([splitStakeAccount, validatorIdentity], instruction)
      throw new Error('failure expected; stake account is not delegated')
    } catch (e) {
      verifyError(e, Errors, 6019, 'cannot be used for bonds')
    }
  })

  it('cannot claim with wrong delegation', async () => {
    const { withdrawRequest } = await initWithdrawRequest(4 * LAMPORTS_PER_SOL)
    await warpToUnlockClaiming()

    const { stakeAccount } = await delegatedStakeAccount({
      provider,
      lamports: LAMPORTS_PER_SOL * 2,
    })

    const { instruction, splitStakeAccount } =
      await claimWithdrawRequestInstruction({
        program,
        authority: validatorIdentity,
        withdrawRequestAccount: withdrawRequest,
        bondAccount: bond.publicKey,
        stakeAccount,
      })

    try {
      await provider.sendIx([splitStakeAccount, validatorIdentity], instruction)
      throw new Error('failure expected as delegated to wrong validator')
    } catch (e) {
      verifyError(e, Errors, 6020, 'delegated to a wrong validator')
    }
  })

  it('cannot claim with wrong stake account authority', async () => {
    const stakeAccountStaker = new Keypair()
    const stakeAccountWithdrawer = new Keypair()
    const [bondsAuth] = bondsWithdrawerAuthority(
      configAccount,
      program.programId
    )
    const [settlementAuth] = settlementStakerAuthority(
      new Keypair().publicKey,
      program.programId
    )

    const { stakeAccount, withdrawer } = await delegatedStakeAccount({
      provider,
      lamports: LAMPORTS_PER_SOL * 2,
      staker: stakeAccountStaker,
      withdrawer: stakeAccountWithdrawer,
      voteAccountToDelegate: voteAccount,
    })
    const { withdrawRequest } = await initWithdrawRequest(4 * LAMPORTS_PER_SOL)
    await warpToUnlockClaiming()

    const { instruction, splitStakeAccount } =
      await claimWithdrawRequestInstruction({
        program,
        authority: validatorIdentity,
        withdrawRequestAccount: withdrawRequest,
        bondAccount: bond.publicKey,
        stakeAccount,
      })

    try {
      await provider.sendIx([splitStakeAccount, validatorIdentity], instruction)
      throw new Error('failure expected; wrong withdrawer')
    } catch (e) {
      verifyError(e, Errors, 6012, 'Wrong withdrawer authority')
    }

    await authorizeStakeAccount({
      provider,
      stakeAccount,
      authority: withdrawer,
      staker: settlementAuth,
    })
    await warpToNextEpoch(provider)
    try {
      await provider.sendIx([splitStakeAccount, validatorIdentity], instruction)
      throw new Error('failure expected; wrong withdrawer')
    } catch (e) {
      verifyError(e, Errors, 6012, 'Wrong withdrawer authority')
    }

    await authorizeStakeAccount({
      provider,
      stakeAccount,
      authority: withdrawer,
      withdrawer: bondsAuth,
    })
    await warpToNextEpoch(provider)
    try {
      await provider.sendIx([splitStakeAccount, validatorIdentity], instruction)
      throw new Error('failure expected; wrong staker')
    } catch (e) {
      verifyError(e, Errors, 6028, 'already funded to a settlement')
    }
  })

  async function warpToUnlockClaiming() {
    await warpOffsetEpoch(provider, withdrawLockupEpochs + 1)
  }

  async function createStakeAccountAndInitWithdraw(
    fundStakeLamports: number,
    initWithdrawAmount: number
  ): Promise<{
    withdrawRequest: PublicKey
    stakeAccount: PublicKey
  }> {
    const { stakeAccount: stakeAccount } = await delegateAndFund({
      program,
      provider,
      lamports: fundStakeLamports,
      voteAccount,
      bondAccount: bond.publicKey,
    })
    const { withdrawRequest } = await initWithdrawRequest(initWithdrawAmount)
    return { withdrawRequest, stakeAccount }
  }

  async function initWithdrawRequest(
    initWithdrawAmount: number
  ): Promise<{ withdrawRequest: PublicKey }> {
    const { withdrawRequestAccount } =
      await executeInitWithdrawRequestInstruction({
        program,
        provider,
        bondAccount: bond.publicKey,
        validatorIdentity,
        amount: initWithdrawAmount,
      })
    const withdrawRequestData = await getWithdrawRequest(
      program,
      withdrawRequestAccount
    )
    expect(withdrawRequestData.voteAccount).toEqual(voteAccount)
    return { withdrawRequest: withdrawRequestAccount }
  }
})
