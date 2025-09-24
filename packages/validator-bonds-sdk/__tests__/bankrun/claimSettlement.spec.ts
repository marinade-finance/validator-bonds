import assert from 'assert'

import { verifyError } from '@marinade.finance/anchor-common'
import {
  assertNotExist,
  currentEpoch,
  warpOffsetEpoch,
  warpToNextEpoch,
} from '@marinade.finance/bankrun-utils'
import { signer, pubkey, createUserAndFund } from '@marinade.finance/web3js-1x'
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js'
import BN from 'bn.js'

import {
  StakeActivationState,
  initBankrunTest,
  stakeActivation,
  warpOffsetSlot,
} from './bankrun'
import {
  Errors,
  bondsWithdrawerAuthority,
  fundBondInstruction,
  claimSettlementV2Instruction,
  fundSettlementInstruction,
  getConfig,
  getRentExemptStake,
  getSettlement,
  settlementStakerAuthority,
  getSettlementClaims,
  getSettlementClaimsBySettlement,
  isClaimed,
} from '../../src'
import { executeTxWithError } from '../utils/helpers'
import {
  MERKLE_ROOT_VOTE_ACCOUNT_1_BUF,
  MERKLE_ROOT_VOTE_ACCOUNT_2_BUF,
  configAccountKeypair,
  createWithdrawerUsers,
  totalClaimVoteAccount1,
  totalClaimVoteAccount2,
  treeNodeBy,
  treeNodesVoteAccount1,
  voteAccount1Keypair,
  voteAccount2Keypair,
  withdrawer1,
  withdrawer2,
  withdrawer3,
  withdrawer4,
} from '../utils/merkleTreeTestData'
import {
  createBondsFundedStakeAccount,
  createSettlementFundedDelegatedStake,
  createDelegatedStakeAccount,
  createVoteAccount,
  createInitializedStakeAccount,
  delegatedStakeAccount,
} from '../utils/staking'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '../utils/testTransactions'

import type { ValidatorBondsProgram } from '../../src'
import type { BankrunExtendedProvider } from '@marinade.finance/bankrun-utils'
import type { PublicKey } from '@solana/web3.js'

describe('Validator Bonds claim settlement', () => {
  const epochsToClaimSettlement = 4
  // the test activates the stake account, we need to set slots to be
  // after the start of the next epoch when the stake account is active as we warped there
  let slotsToStartSettlementClaiming: bigint
  let settlement1ClaimingExpires: bigint
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let bondAccount1: PublicKey
  let operatorAuthority: Keypair
  let validatorIdentity1: Keypair
  let voteAccount1: PublicKey
  let validatorIdentity2: Keypair
  let voteAccount2: PublicKey
  let settlementAccount1: PublicKey
  let settlementAccount2: PublicKey
  let settlementEpoch: bigint
  let rentCollector: Keypair
  let stakeAccount1: PublicKey
  let stakeAccount2: PublicKey

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())

    const epochNow = await currentEpoch(provider)
    const firstSlotOfEpoch = getFirstSlotOfEpoch(provider, epochNow)
    const firstSlotOfNextEpoch = getFirstSlotOfEpoch(
      provider,
      epochNow + BigInt(1)
    )
    slotsToStartSettlementClaiming =
      firstSlotOfNextEpoch - firstSlotOfEpoch + BigInt(3)
    ;({ configAccount, operatorAuthority } = await executeInitConfigInstruction(
      {
        program,
        provider,
        epochsToClaimSettlement,
        slotsToStartSettlementClaiming,
        configAccountKeypair: configAccountKeypair,
      }
    ))
    ;({ voteAccount: voteAccount1, validatorIdentity: validatorIdentity1 } =
      await createVoteAccount({
        voteAccount: voteAccount1Keypair,
        provider,
      }))
    ;({ bondAccount: bondAccount1 } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount: voteAccount1,
      validatorIdentity: validatorIdentity1,
    }))
    ;({ voteAccount: voteAccount2, validatorIdentity: validatorIdentity2 } =
      await createVoteAccount({
        voteAccount: voteAccount2Keypair,
        provider,
      }))
    await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount: voteAccount2,
      validatorIdentity: validatorIdentity2,
    })
  })

  async function initVariousTest() {
    rentCollector = Keypair.generate()
    settlementEpoch = await currentEpoch(provider)
    ;({ settlementAccount: settlementAccount1 } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount: voteAccount1,
      operatorAuthority,
      currentEpoch: settlementEpoch,
      rentCollector: rentCollector.publicKey,
      merkleRoot: MERKLE_ROOT_VOTE_ACCOUNT_1_BUF,
      maxMerkleNodes: 1,
      maxTotalClaim: totalClaimVoteAccount1,
    }))
    const settlement1Slot = (await getSettlement(program, settlementAccount1))
      .slotCreatedAt
    settlement1ClaimingExpires =
      BigInt(settlement1Slot.toString()) +
      BigInt(slotsToStartSettlementClaiming)
    ;({ settlementAccount: settlementAccount2 } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount: voteAccount2,
      operatorAuthority,
      currentEpoch: settlementEpoch,
      merkleRoot: MERKLE_ROOT_VOTE_ACCOUNT_2_BUF,
      // possible to claims up to index 4
      maxMerkleNodes: 5,
      maxTotalClaim: 100, // has to be lower than 111111
    }))
    stakeAccount1 = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      voteAccount: voteAccount1,
      lamports: totalClaimVoteAccount1.toNumber() + LAMPORTS_PER_SOL * 5,
    })
    stakeAccount2 = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      voteAccount: voteAccount2,
      lamports: totalClaimVoteAccount2.toNumber() + LAMPORTS_PER_SOL * 6,
    })

    await warpToNextEpoch(provider) // activate stake account

    const { instruction: fundIx1, splitStakeAccount: split1 } =
      await fundSettlementInstruction({
        program,
        settlementAccount: settlementAccount1,
        stakeAccount: stakeAccount1,
      })
    const { instruction: fundIx2, splitStakeAccount: split2 } =
      await fundSettlementInstruction({
        program,
        settlementAccount: settlementAccount2,
        stakeAccount: stakeAccount2,
      })
    await provider.sendIx(
      [signer(split1), signer(split2), operatorAuthority],
      fundIx1,
      fundIx2
    )
    await createWithdrawerUsers(provider)
  }

  it('claim settlement various', async () => {
    await initVariousTest()

    const treeNode1Withdrawer1 = treeNodeBy(voteAccount1, withdrawer1)
    const stakeAccountLamportsBefore = 123 * LAMPORTS_PER_SOL
    const stakeAccountTreeNode1Withdrawer1 = await createDelegatedStakeAccount({
      provider,
      lamports: stakeAccountLamportsBefore,
      voteAccount: voteAccount1,
      staker: treeNode1Withdrawer1.treeNode.stakeAuthority,
      withdrawer: treeNode1Withdrawer1.treeNode.withdrawAuthority,
    })
    const { instruction: ixWrongTreeNode } = await claimSettlementV2Instruction(
      {
        program,
        claimAmount: treeNode1Withdrawer1.treeNode.claim.subn(1),
        index: treeNode1Withdrawer1.treeNode.index,
        merkleProof: treeNode1Withdrawer1.proof,
        settlementAccount: settlementAccount1,
        stakeAccountFrom: stakeAccount1,
        stakeAccountTo: stakeAccountTreeNode1Withdrawer1,
        stakeAccountStaker: treeNode1Withdrawer1.treeNode.stakeAuthority,
        stakeAccountWithdrawer: treeNode1Withdrawer1.treeNode.withdrawAuthority,
      }
    )
    try {
      await provider.sendIx([], ixWrongTreeNode)
      throw new Error(
        'failure expected; slots to start settlement claiming not reached'
      )
    } catch (e) {
      verifyError(e, Errors, 6061, 'slots to start claiming not expired yet')
    }

    provider.context.warpToSlot(settlement1ClaimingExpires - BigInt(1))
    try {
      await provider.sendIx([], ixWrongTreeNode)
      throw new Error(
        'failure expected; slots to start settlement claiming not reached'
      )
    } catch (e) {
      verifyError(e, Errors, 6061, 'slots to start claiming not expired yet')
    }
    provider.context.warpToSlot(settlement1ClaimingExpires)

    try {
      await provider.sendIx([], ixWrongTreeNode)
      throw new Error('should have failed; wrong tree node proof')
    } catch (e) {
      verifyError(e, Errors, 6029, 'claim proof failed')
    }

    const { instruction } = await claimSettlementV2Instruction({
      program,
      claimAmount: treeNode1Withdrawer1.treeNode.claim,
      index: treeNode1Withdrawer1.treeNode.index,
      merkleProof: treeNode1Withdrawer1.proof,
      settlementAccount: settlementAccount1,
      stakeAccountFrom: stakeAccount1,
      stakeAccountTo: stakeAccountTreeNode1Withdrawer1,
      stakeAccountStaker: treeNode1Withdrawer1.treeNode.stakeAuthority,
      stakeAccountWithdrawer: treeNode1Withdrawer1.treeNode.withdrawAuthority,
    })
    await executeTxWithError(
      provider,
      '',
      'insufficient funds',
      [],
      instruction
    )

    expect(
      await isClaimed(
        program,
        settlementAccount1,
        treeNode1Withdrawer1.treeNode.index
      )
    ).toBeFalsy()

    const notAStakeAccount = await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL,
    })
    const { instruction: ixWrongStakeAccountTo } =
      await claimSettlementV2Instruction({
        program,
        claimAmount: treeNode1Withdrawer1.treeNode.claim,
        index: treeNode1Withdrawer1.treeNode.index,
        merkleProof: treeNode1Withdrawer1.proof,
        settlementAccount: settlementAccount1,
        stakeAccountFrom: stakeAccount1,
        stakeAccountTo: pubkey(notAStakeAccount),
        stakeAccountStaker: treeNode1Withdrawer1.treeNode.stakeAuthority,
        stakeAccountWithdrawer: treeNode1Withdrawer1.treeNode.withdrawAuthority,
      })
    await expect(provider.sendIx([], ixWrongStakeAccountTo)).rejects.toThrow(
      /custom program error: 0xbbf/
    )
    const stakeAccountWrongStaker = await createDelegatedStakeAccount({
      provider,
      lamports: 3 * LAMPORTS_PER_SOL,
      voteAccount: voteAccount1,
      staker: pubkey(notAStakeAccount),
      withdrawer: treeNode1Withdrawer1.treeNode.withdrawAuthority,
    })
    const { instruction: ixWrongStaker } = await claimSettlementV2Instruction({
      program,
      claimAmount: treeNode1Withdrawer1.treeNode.claim,
      index: treeNode1Withdrawer1.treeNode.index,
      merkleProof: treeNode1Withdrawer1.proof,
      settlementAccount: settlementAccount1,
      stakeAccountFrom: stakeAccount1,
      stakeAccountTo: stakeAccountWrongStaker,
      stakeAccountStaker: treeNode1Withdrawer1.treeNode.stakeAuthority,
      stakeAccountWithdrawer: treeNode1Withdrawer1.treeNode.withdrawAuthority,
    })
    try {
      await provider.sendIx([], ixWrongStaker)
      throw new Error('should have failed; wrong staker')
    } catch (e) {
      verifyError(e, Errors, 6051, 'Wrong staker authority')
    }
    const stakeAccountWrongWithdrawer = await createDelegatedStakeAccount({
      provider,
      lamports: 3 * LAMPORTS_PER_SOL,
      voteAccount: voteAccount1,
      staker: treeNode1Withdrawer1.treeNode.stakeAuthority,
      withdrawer: pubkey(notAStakeAccount),
    })
    const { instruction: ixWrongWithdrawer } =
      await claimSettlementV2Instruction({
        program,
        claimAmount: treeNode1Withdrawer1.treeNode.claim,
        index: treeNode1Withdrawer1.treeNode.index,
        merkleProof: treeNode1Withdrawer1.proof,
        settlementAccount: settlementAccount1,
        stakeAccountFrom: stakeAccount1,
        stakeAccountTo: stakeAccountWrongWithdrawer,
        stakeAccountStaker: treeNode1Withdrawer1.treeNode.stakeAuthority,
        stakeAccountWithdrawer: treeNode1Withdrawer1.treeNode.withdrawAuthority,
      })
    try {
      await provider.sendIx([], ixWrongWithdrawer)
      throw new Error('should have failed; wrong withdrawer')
    } catch (e) {
      verifyError(e, Errors, 6012, 'Wrong withdrawer authority')
    }

    const stakeAccountNotBigEnough = await createSettlementFundedDelegatedStake(
      {
        program,
        provider,
        configAccount,
        settlementAccount: settlementAccount1,
        lamports: new BN(LAMPORTS_PER_SOL)
          .add(new BN(await getRentExemptStake(provider)))
          .add(treeNode1Withdrawer1.treeNode.claim)
          .subn(1)
          .toNumber(),
        voteAccount: voteAccount1,
      }
    )
    const { instruction: fundIxBit, splitStakeAccount } =
      await fundSettlementInstruction({
        program,
        settlementAccount: settlementAccount1,
        stakeAccount: stakeAccountNotBigEnough,
      })
    await provider.sendIx(
      [operatorAuthority, signer(splitStakeAccount)],
      fundIxBit
    )
    const { instruction: ixWrongStakeSize } =
      await claimSettlementV2Instruction({
        program,
        claimAmount: treeNode1Withdrawer1.treeNode.claim,
        index: treeNode1Withdrawer1.treeNode.index,
        merkleProof: treeNode1Withdrawer1.proof,
        settlementAccount: settlementAccount1,
        stakeAccountFrom: stakeAccountNotBigEnough,
        stakeAccountTo: stakeAccountTreeNode1Withdrawer1,
        stakeAccountStaker: treeNode1Withdrawer1.treeNode.stakeAuthority,
        stakeAccountWithdrawer: treeNode1Withdrawer1.treeNode.withdrawAuthority,
      })
    try {
      await provider.sendIx([], ixWrongStakeSize)
      throw new Error('should have failed; wrong withdrawer')
    } catch (e) {
      verifyError(e, Errors, 6035, 'has not enough lamports to cover')
    }

    await warpToNextEpoch(provider) // deactivate stake account

    await provider.sendIx([], instruction)

    const stakeAccountInfo = await provider.connection.getAccountInfo(
      stakeAccountTreeNode1Withdrawer1
    )
    expect(stakeAccountInfo?.lamports).toEqual(
      stakeAccountLamportsBefore +
        treeNode1Withdrawer1.treeNode.claim.toNumber()
    )
    const settlementClaims = await getSettlementClaimsBySettlement(
      program,
      settlementAccount1
    )
    expect(
      settlementClaims.bitmap.isSet(treeNode1Withdrawer1.treeNode.index)
    ).toBe(true)
    expect(settlementClaims.bitmap.bitSet.counter).toEqual(1)
    expect(settlementClaims.bitmap.bitSet.asString.includes('1')).toBe(true)

    expect(
      await isClaimed(
        program,
        settlementAccount1,
        treeNode1Withdrawer1.treeNode.index
      )
    ).toBeTruthy()

    const settlementData = await getSettlement(program, settlementAccount1)
    expect(settlementData.lamportsClaimed).toEqual(
      treeNode1Withdrawer1.treeNode.claim
    )
    expect(settlementData.merkleNodesClaimed).toEqual(1)

    await warpToNextEpoch(provider)

    try {
      await provider.sendIx([], instruction)
      throw new Error('should have failed; already claimed')
    } catch (e) {
      verifyError(e, Errors, 6070, 'has been already claimed')
    }

    const treeNode1Withdrawer2 = treeNodeBy(voteAccount1, withdrawer2)
    const stakeAccountTreeNode1Withdrawer2 = await createDelegatedStakeAccount({
      provider,
      lamports: 369 * LAMPORTS_PER_SOL,
      voteAccount: voteAccount1,
      staker: treeNode1Withdrawer2.treeNode.stakeAuthority,
      withdrawer: treeNode1Withdrawer2.treeNode.withdrawAuthority,
    })
    const { instruction: ixWrongMerkleTreeNodes } =
      await claimSettlementV2Instruction({
        program,
        claimAmount: treeNode1Withdrawer2.treeNode.claim,
        index: treeNode1Withdrawer2.treeNode.index,
        merkleProof: treeNode1Withdrawer2.proof,
        settlementAccount: settlementAccount1,
        stakeAccountFrom: stakeAccount1,
        stakeAccountTo: stakeAccountTreeNode1Withdrawer2,
        stakeAccountStaker: treeNode1Withdrawer2.treeNode.stakeAuthority,
        stakeAccountWithdrawer: treeNode1Withdrawer2.treeNode.withdrawAuthority,
      })
    try {
      await provider.sendIx([], ixWrongMerkleTreeNodes)
      throw new Error('should have failed; provided wrong index')
    } catch (e) {
      verifyError(e, Errors, 6066, 'index out of bounds')
    }

    const treeNode2Withdrawer2 = treeNodeBy(voteAccount2, withdrawer2)
    const stakeAccountTreeNode2Withdrawer2 = await createDelegatedStakeAccount({
      provider,
      lamports: 32 * LAMPORTS_PER_SOL,
      voteAccount: voteAccount1,
      staker: treeNode2Withdrawer2.treeNode.stakeAuthority,
      withdrawer: treeNode2Withdrawer2.treeNode.withdrawAuthority,
    })
    const { instruction: treeNode2Withdrawer2Ix } =
      await claimSettlementV2Instruction({
        program,
        claimAmount: treeNode2Withdrawer2.treeNode.claim,
        index: treeNode2Withdrawer2.treeNode.index,
        merkleProof: treeNode2Withdrawer2.proof,
        settlementAccount: settlementAccount2,
        stakeAccountFrom: stakeAccount2,
        stakeAccountTo: stakeAccountTreeNode2Withdrawer2,
        stakeAccountStaker: treeNode2Withdrawer2.treeNode.stakeAuthority,
        stakeAccountWithdrawer: treeNode2Withdrawer2.treeNode.withdrawAuthority,
      })
    try {
      await provider.sendIx([], treeNode2Withdrawer2Ix)
      throw new Error(
        'should have failed; over claimed (wrong argument on settlement)'
      )
    } catch (e) {
      verifyError(e, Errors, 6032, 'the max total claim')
    }

    const treeNode2Withdrawer1 = treeNodeBy(voteAccount2, withdrawer1)
    const stakeAccountTreeNode2Withdrawer1 = await createDelegatedStakeAccount({
      provider,
      lamports: 11 * LAMPORTS_PER_SOL,
      voteAccount: voteAccount1,
      staker: treeNode2Withdrawer1.treeNode.stakeAuthority,
      withdrawer: treeNode2Withdrawer1.treeNode.withdrawAuthority,
    })
    const { instruction: ixWrongStakeAccount } =
      await claimSettlementV2Instruction({
        program,
        claimAmount: treeNode2Withdrawer1.treeNode.claim,
        index: treeNode2Withdrawer1.treeNode.index,
        merkleProof: treeNode2Withdrawer1.proof,
        settlementAccount: settlementAccount2,
        stakeAccountFrom: stakeAccount1,
        stakeAccountTo: stakeAccountTreeNode2Withdrawer1,
        stakeAccountStaker: treeNode2Withdrawer1.treeNode.stakeAuthority,
        stakeAccountWithdrawer: treeNode2Withdrawer1.treeNode.withdrawAuthority,
      })
    try {
      await provider.sendIx([], ixWrongStakeAccount)
      throw new Error('should have failed; wrong stake account')
    } catch (e) {
      verifyError(e, Errors, 6036, 'not funded under the settlement')
    }
    const { instruction: ixIndexOutOfBound } =
      await claimSettlementV2Instruction({
        program,
        claimAmount: treeNode2Withdrawer1.treeNode.claim,
        index: 6,
        merkleProof: treeNode2Withdrawer1.proof,
        settlementAccount: settlementAccount2,
        stakeAccountFrom: stakeAccount1,
        stakeAccountTo: stakeAccountTreeNode2Withdrawer1,
        stakeAccountStaker: treeNode2Withdrawer1.treeNode.stakeAuthority,
        stakeAccountWithdrawer: treeNode2Withdrawer1.treeNode.withdrawAuthority,
      })
    try {
      await provider.sendIx([], ixIndexOutOfBound)
      throw new Error('should have failed; index out of bound')
    } catch (e) {
      verifyError(e, Errors, 6066, 'index out of bounds')
    }

    const {
      instruction: treeNode2Withdrawer1Ix,
      settlementClaimsAccount: treeNode2SettlementClaimsAccount,
    } = await claimSettlementV2Instruction({
      program,
      claimAmount: treeNode2Withdrawer1.treeNode.claim,
      merkleProof: treeNode2Withdrawer1.proof,
      index: treeNode2Withdrawer1.treeNode.index,
      settlementAccount: settlementAccount2,
      stakeAccountFrom: stakeAccount2,
      stakeAccountTo: stakeAccountTreeNode2Withdrawer1,
      stakeAccountStaker: treeNode2Withdrawer1.treeNode.stakeAuthority,
      stakeAccountWithdrawer: treeNode2Withdrawer1.treeNode.withdrawAuthority,
    })
    await provider.sendIx([], treeNode2Withdrawer1Ix)

    const settlementClaimsTreeNode2 = await getSettlementClaims(
      program,
      treeNode2SettlementClaimsAccount
    )
    expect(settlementClaimsTreeNode2.account.maxRecords).toEqual(5)
    expect(settlementClaimsTreeNode2.bitmap.bitSet.counter).toEqual(1)
    expect(
      settlementClaimsTreeNode2.bitmap.isSet(
        treeNode2Withdrawer1.treeNode.index
      )
    ).toBe(true)

    await warpToNotBeClaimable()

    const treeNode1Withdrawer3 = treeNodeBy(voteAccount1, withdrawer3)
    const stakeAccountTreeNode1Withdrawer3 = await createDelegatedStakeAccount({
      provider,
      lamports: 11 * LAMPORTS_PER_SOL,
      voteAccount: voteAccount1,
      staker: treeNode1Withdrawer3.treeNode.stakeAuthority,
      withdrawer: treeNode1Withdrawer3.treeNode.withdrawAuthority,
    })
    const { instruction: ixTooLate } = await claimSettlementV2Instruction({
      program,
      claimAmount: treeNode1Withdrawer3.treeNode.claim,
      index: treeNode1Withdrawer3.treeNode.index,
      merkleProof: treeNode1Withdrawer3.proof,
      settlementAccount: settlementAccount1,
      stakeAccountFrom: stakeAccount1,
      stakeAccountTo: stakeAccountTreeNode1Withdrawer3,
      stakeAccountStaker: treeNode1Withdrawer3.treeNode.stakeAuthority,
      stakeAccountWithdrawer: treeNode1Withdrawer3.treeNode.withdrawAuthority,
    })
    try {
      await provider.sendIx([], ixTooLate)
      throw new Error('should have failed; too late to claim')
    } catch (e) {
      verifyError(e, Errors, 6023, 'already expired')
    }

    await expect(
      isClaimed(
        program,
        settlementAccount1,
        treeNode1Withdrawer3.treeNode.index
      )
    ).rejects.toThrow('Index 2 out of range')
  })

  it('claim settlement with exact match on stake account size', async () => {
    await warpToNextEpoch(provider) // we want to have different settlement account address

    settlementEpoch = await currentEpoch(provider)
    const maxTotalClaim = treeNodesVoteAccount1
      .map(t => t.treeNode.claim)
      .reduce((a, b) => a.add(b))
    const { settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount: voteAccount1,
      operatorAuthority,
      currentEpoch: settlementEpoch,
      merkleRoot: MERKLE_ROOT_VOTE_ACCOUNT_1_BUF,
      maxMerkleNodes: treeNodesVoteAccount1.length,
      maxTotalClaim,
    })
    const [withdrawAuth] = bondsWithdrawerAuthority(
      configAccount,
      program.programId
    )
    const [stakeAuth] = settlementStakerAuthority(
      settlementAccount,
      program.programId
    )

    const amount1 = LAMPORTS_PER_SOL * 1
    const amount2 = LAMPORTS_PER_SOL * 42

    const treeNode1Withdrawer4 = treeNodesVoteAccount1.filter(t =>
      t.treeNode.data.withdrawAuthority.equals(withdrawer4)
    )
    expect(treeNode1Withdrawer4.length).toEqual(2)
    const treeNode1OneLamport = treeNode1Withdrawer4.find(
      t => t.treeNode.claim.toNumber() === amount1
    )
    assert(treeNode1OneLamport !== undefined)
    const { stakeAccount: stakeAccountOneLamportFrom } =
      await createInitializedStakeAccount({
        provider,
        rentExempt: amount1,
        staker: stakeAuth,
        withdrawer: withdrawAuth,
      })
    const treeNode42Lamports = treeNode1Withdrawer4.find(
      t => t.treeNode.claim.toNumber() === amount2
    )
    assert(treeNode42Lamports !== undefined)
    const { stakeAccount: stakeAccount42LamportsFrom } =
      await createInitializedStakeAccount({
        provider,
        rentExempt: amount2,
        staker: stakeAuth,
        withdrawer: withdrawAuth,
      })

    const stakeAccountOneLamportTo = await createDelegatedStakeAccount({
      provider,
      lamports: 10 * LAMPORTS_PER_SOL,
      voteAccount: voteAccount1,
      staker: treeNode1OneLamport.treeNode.stakeAuthority,
      withdrawer: treeNode1OneLamport.treeNode.withdrawAuthority,
    })
    const stakeAccount42LamportsTo = await createDelegatedStakeAccount({
      provider,
      lamports: 10 * LAMPORTS_PER_SOL,
      voteAccount: voteAccount1,
      staker: treeNode42Lamports.treeNode.stakeAuthority,
      withdrawer: treeNode42Lamports.treeNode.withdrawAuthority,
    })

    // warp to be able to claim (see slotsToStartSettlementClaiming)
    await warpToNextEpoch(provider)

    const { instruction: ix1 } = await claimSettlementV2Instruction({
      program,
      claimAmount: amount1,
      index: treeNode1OneLamport.treeNode.data.index,
      merkleProof: treeNode1OneLamport.proof,
      settlementAccount: settlementAccount,
      stakeAccountFrom: stakeAccountOneLamportFrom,
      stakeAccountTo: stakeAccountOneLamportTo,
      stakeAccountStaker: treeNode1OneLamport.treeNode.stakeAuthority,
      stakeAccountWithdrawer: treeNode1OneLamport.treeNode.withdrawAuthority,
    })
    await provider.sendIx([], ix1)
    await assertNotExist(provider, stakeAccountOneLamportFrom)

    const { instruction: ix2 } = await claimSettlementV2Instruction({
      program,
      claimAmount: amount2,
      index: treeNode42Lamports.treeNode.data.index,
      merkleProof: treeNode42Lamports.proof,
      settlementAccount: settlementAccount,
      stakeAccountFrom: stakeAccount42LamportsFrom,
      stakeAccountTo: stakeAccount42LamportsTo,
      stakeAccountStaker: treeNode42Lamports.treeNode.stakeAuthority,
      stakeAccountWithdrawer: treeNode42Lamports.treeNode.withdrawAuthority,
    })
    await provider.sendIx([], ix2)
    await assertNotExist(provider, stakeAccount42LamportsFrom)
  })

  it('claim activating stake account', async () => {
    await warpToNextEpoch(provider) // we want to have different settlement

    settlementEpoch = await currentEpoch(provider)
    const { settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount: voteAccount1,
      operatorAuthority,
      currentEpoch: settlementEpoch,
      merkleRoot: MERKLE_ROOT_VOTE_ACCOUNT_1_BUF,
      maxMerkleNodes: treeNodesVoteAccount1.length,
      maxTotalClaim: 42 * LAMPORTS_PER_SOL,
    })

    const { stakeAccount, withdrawer } = await delegatedStakeAccount({
      provider,
      lamports: LAMPORTS_PER_SOL * 2345,
      voteAccountToDelegate: voteAccount1,
    })
    expect(await stakeActivation(provider, stakeAccount)).toEqual(
      StakeActivationState.Activating
    )
    const { instruction: fundBondIx } = await fundBondInstruction({
      program,
      configAccount,
      bondAccount: bondAccount1,
      stakeAccount,
      stakeAccountAuthority: withdrawer,
    })
    const { instruction: fundSettlementIx, splitStakeAccount } =
      await fundSettlementInstruction({
        program,
        configAccount,
        bondAccount: bondAccount1,
        voteAccount: voteAccount1,
        operatorAuthority: operatorAuthority.publicKey,
        settlementAccount,
        stakeAccount,
      })
    await provider.sendIx(
      [withdrawer, operatorAuthority, signer(splitStakeAccount)],
      fundBondIx,
      fundSettlementIx
    )

    // warp to be able to claim (see slotsToStartSettlementClaiming)
    const config = await getConfig(program, configAccount)
    await warpOffsetSlot(
      provider,
      config.slotsToStartSettlementClaiming.toNumber()
    )

    const treeNode = treeNodesVoteAccount1[0]
    assert(treeNode !== undefined)
    const lamportsTo = 10 * LAMPORTS_PER_SOL
    const stakeAccountTo = await createDelegatedStakeAccount({
      provider,
      lamports: lamportsTo,
      voteAccount: voteAccount1,
      staker: treeNode.treeNode.stakeAuthority,
      withdrawer: treeNode.treeNode.withdrawAuthority,
    })
    const { instruction: ix1 } = await claimSettlementV2Instruction({
      program,
      claimAmount: treeNode.treeNode.data.claim,
      index: treeNode.treeNode.data.index,
      merkleProof: treeNode.proof,
      settlementAccount: settlementAccount,
      stakeAccountFrom: stakeAccount,
      stakeAccountTo: stakeAccountTo,
      stakeAccountStaker: treeNode.treeNode.stakeAuthority,
      stakeAccountWithdrawer: treeNode.treeNode.withdrawAuthority,
    })
    await provider.sendIx([], ix1)

    expect(
      (await provider.connection.getAccountInfo(stakeAccountTo))?.lamports
    ).toEqual(lamportsTo + treeNode.treeNode.data.claim.toNumber())
  })

  async function warpToNotBeClaimable() {
    await warpOffsetEpoch(provider, epochsToClaimSettlement + 1)
  }
})

// https://github.com/solana-labs/solana/blob/v1.17.7/sdk/program/src/epoch_schedule.rs#L29C1-L29C45
// https://github.com/solana-labs/solana/blob/v1.17.7/sdk/program/src/epoch_schedule.rs#L167
function getFirstSlotOfEpoch(
  provider: BankrunExtendedProvider,
  epoch: number | bigint | BN
): bigint {
  const epochBigInt = BigInt(epoch.toString())
  const { slotsPerEpoch, firstNormalEpoch, firstNormalSlot } =
    provider.context.genesisConfig.epochSchedule
  let firstEpochSlot: bigint
  const MINIMUM_SLOTS_PER_EPOCH = BigInt(32)
  if (epochBigInt <= firstNormalEpoch) {
    firstEpochSlot =
      (BigInt(2) ** epochBigInt - BigInt(1)) * MINIMUM_SLOTS_PER_EPOCH
  } else {
    firstEpochSlot =
      (epochBigInt - firstNormalEpoch) * slotsPerEpoch + firstNormalSlot
  }
  return firstEpochSlot
}
