import {
  Errors,
  ValidatorBondsProgram,
  claimSettlementInstruction,
  fundSettlementInstruction,
  getRentExemptStake,
  getSettlement,
  getSettlementClaims,
  getSettlementClaimsBySettlement,
  isClaimed,
} from '../../src'
import {
  BankrunExtendedProvider,
  currentEpoch,
  warpOffsetEpoch,
  warpToNextEpoch,
} from '@marinade.finance/bankrun-utils'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '../utils/testTransactions'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  createBondsFundedStakeAccount,
  createSettlementFundedDelegatedStake,
  createDelegatedStakeAccount,
  createVoteAccount,
} from '../utils/staking'
import {
  signer,
  pubkey,
  createUserAndFund,
} from '@marinade.finance/web3js-common'
import {
  MERKLE_ROOT_VOTE_ACCOUNT_1_BUF,
  MERKLE_ROOT_VOTE_ACCOUNT_2_BUF,
  configAccountKeypair,
  createWithdrawerUsers,
  totalClaimVoteAccount1,
  totalClaimVoteAccount2,
  treeNodeBy,
  voteAccount1Keypair,
  voteAccount2Keypair,
  withdrawer1,
  withdrawer2,
  withdrawer3,
} from '../utils/merkleTreeTestData'
import { verifyError } from '@marinade.finance/anchor-common'
import BN from 'bn.js'
import { executeTxWithError } from '../utils/helpers'
import { initBankrunTest } from './bankrun'

describe('Validator Bonds claim settlement', () => {
  const epochsToClaimSettlement = 4
  // the test activates the stake account, we need to set slots to be
  // after the start of the next epoch when the stake account is active as we warped there
  let slotsToStartSettlementClaiming: number
  let settlement1ClaimingExpires: bigint
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let operatorAuthority: Keypair
  let validatorIdentity1: Keypair
  let voteAccount1: PublicKey
  let validatorIdentity2: Keypair
  let voteAccount2: PublicKey
  let settlementAccount1: PublicKey
  let settlementAccount2: PublicKey
  let settlementEpoch: number
  let rentCollector: Keypair
  let stakeAccount1: PublicKey
  let stakeAccount2: PublicKey

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
    const epochNow = await currentEpoch(provider)
    const firstSlotOfEpoch = await getFirstSlotOfEpoch(provider, epochNow)
    const firstSlotOfNextEpoch = await getFirstSlotOfEpoch(
      provider,
      epochNow + 1
    )
    slotsToStartSettlementClaiming =
      Number(firstSlotOfNextEpoch - firstSlotOfEpoch) + 3
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
    await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount: voteAccount1,
      validatorIdentity: validatorIdentity1,
    })
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
  })

  it('claim settlement various', async () => {
    const [treeNode1Withdrawer1, treeNode1Withdrawer1Index] = treeNodeBy(
      voteAccount1,
      withdrawer1
    )
    const stakeAccountLamportsBefore = 123 * LAMPORTS_PER_SOL
    const stakeAccountTreeNode1Withdrawer1 = await createDelegatedStakeAccount({
      provider,
      lamports: stakeAccountLamportsBefore,
      voteAccount: voteAccount1,
      staker: treeNode1Withdrawer1.treeNode.stakeAuthority,
      withdrawer: treeNode1Withdrawer1.treeNode.withdrawAuthority,
    })
    const { instruction: ixWrongTreeNode } = await claimSettlementInstruction({
      program,
      claimAmount: treeNode1Withdrawer1.treeNode.data.claim.subn(1),
      index: treeNode1Withdrawer1Index,
      merkleProof: treeNode1Withdrawer1.proof,
      settlementAccount: settlementAccount1,
      stakeAccountFrom: stakeAccount1,
      stakeAccountTo: stakeAccountTreeNode1Withdrawer1,
      stakeAccountStaker: treeNode1Withdrawer1.treeNode.stakeAuthority,
      stakeAccountWithdrawer: treeNode1Withdrawer1.treeNode.withdrawAuthority,
    })
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

    const { instruction } = await claimSettlementInstruction({
      program,
      claimAmount: treeNode1Withdrawer1.treeNode.data.claim,
      index: treeNode1Withdrawer1Index,
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
      isClaimed(program, settlementAccount1, treeNode1Withdrawer1Index)
    ).resolves.toBeFalsy()

    const notAStakeAccount = await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL,
    })
    const { instruction: ixWrongStakeAccountTo } =
      await claimSettlementInstruction({
        program,
        claimAmount: treeNode1Withdrawer1.treeNode.data.claim,
        index: treeNode1Withdrawer1Index,
        merkleProof: treeNode1Withdrawer1.proof,
        settlementAccount: settlementAccount1,
        stakeAccountFrom: stakeAccount1,
        stakeAccountTo: pubkey(notAStakeAccount),
        stakeAccountStaker: treeNode1Withdrawer1.treeNode.stakeAuthority,
        stakeAccountWithdrawer: treeNode1Withdrawer1.treeNode.withdrawAuthority,
      })
    try {
      await provider.sendIx([], ixWrongStakeAccountTo)
      throw new Error('should have failed; wrong stake account')
    } catch (e) {
      expect((e as Error).message).toMatch('custom program error: 0xbbf')
    }
    const stakeAccountWrongStaker = await createDelegatedStakeAccount({
      provider,
      lamports: 3 * LAMPORTS_PER_SOL,
      voteAccount: voteAccount1,
      staker: pubkey(notAStakeAccount),
      withdrawer: treeNode1Withdrawer1.treeNode.withdrawAuthority,
    })
    const { instruction: ixWrongStaker } = await claimSettlementInstruction({
      program,
      claimAmount: treeNode1Withdrawer1.treeNode.data.claim,
      index: treeNode1Withdrawer1Index,
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
    const { instruction: ixWrongWithdrawer } = await claimSettlementInstruction(
      {
        program,
        claimAmount: treeNode1Withdrawer1.treeNode.data.claim,
        index: treeNode1Withdrawer1Index,
        merkleProof: treeNode1Withdrawer1.proof,
        settlementAccount: settlementAccount1,
        stakeAccountFrom: stakeAccount1,
        stakeAccountTo: stakeAccountWrongWithdrawer,
        stakeAccountStaker: treeNode1Withdrawer1.treeNode.stakeAuthority,
        stakeAccountWithdrawer: treeNode1Withdrawer1.treeNode.withdrawAuthority,
      }
    )
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
          .add(treeNode1Withdrawer1.treeNode.data.claim)
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
    const { instruction: ixWrongStakeSize } = await claimSettlementInstruction({
      program,
      claimAmount: treeNode1Withdrawer1.treeNode.data.claim,
      index: treeNode1Withdrawer1Index,
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
        treeNode1Withdrawer1.treeNode.data.claim.toNumber()
    )
    const settlementClaims = await getSettlementClaimsBySettlement(
      program,
      settlementAccount1
    )
    expect(settlementClaims.bitmap.isSet(treeNode1Withdrawer1Index)).toBe(true)
    expect(settlementClaims.bitmap.bitSet.counter).toEqual(1)
    expect(settlementClaims.bitmap.bitSet.asString.includes('1')).toBe(true)

    expect(
      isClaimed(program, settlementAccount1, treeNode1Withdrawer1Index)
    ).resolves.toBeTruthy()

    const settlementData = await getSettlement(program, settlementAccount1)
    expect(settlementData.lamportsClaimed).toEqual(
      treeNode1Withdrawer1.treeNode.data.claim
    )
    expect(settlementData.merkleNodesClaimed).toEqual(1)

    await warpToNextEpoch(provider)

    try {
      await provider.sendIx([], instruction)
      throw new Error('should have failed; already claimed')
    } catch (e) {
      verifyError(e, Errors, 6069, 'already claimed')
    }

    const [treeNode1Withdrawer2, treeNode1Withdrawer2Index] = treeNodeBy(
      voteAccount1,
      withdrawer2
    )
    const stakeAccountTreeNode1Withdrawer2 = await createDelegatedStakeAccount({
      provider,
      lamports: 369 * LAMPORTS_PER_SOL,
      voteAccount: voteAccount1,
      staker: treeNode1Withdrawer2.treeNode.stakeAuthority,
      withdrawer: treeNode1Withdrawer2.treeNode.withdrawAuthority,
    })
    const { instruction: ixWrongMerkleTreeNodes } =
      await claimSettlementInstruction({
        program,
        claimAmount: treeNode1Withdrawer2.treeNode.data.claim,
        index: treeNode1Withdrawer2Index,
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
      verifyError(e, Errors, 6065, 'index out of bounds')
    }

    // TODO: fix me
    const [treeNode2Withdrawer2, treeNode2Withdrawer2Index] = treeNodeBy(
      voteAccount2,
      withdrawer2
    )
    const stakeAccountTreeNode2Withdrawer2 = await createDelegatedStakeAccount({
      provider,
      lamports: 32 * LAMPORTS_PER_SOL,
      voteAccount: voteAccount1,
      staker: treeNode2Withdrawer2.treeNode.stakeAuthority,
      withdrawer: treeNode2Withdrawer2.treeNode.withdrawAuthority,
    })
    const { instruction: treeNode2Withdrawer2Ix } =
      await claimSettlementInstruction({
        program,
        claimAmount: treeNode2Withdrawer2.treeNode.data.claim,
        index: treeNode2Withdrawer2Index,
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

    const [treeNode2Withdrawer1, treeNode2Withdrawer1Index] = treeNodeBy(
      voteAccount2,
      withdrawer1
    )
    const stakeAccountTreeNode2Withdrawer1 = await createDelegatedStakeAccount({
      provider,
      lamports: 11 * LAMPORTS_PER_SOL,
      voteAccount: voteAccount1,
      staker: treeNode2Withdrawer1.treeNode.stakeAuthority,
      withdrawer: treeNode2Withdrawer1.treeNode.withdrawAuthority,
    })
    const { instruction: ixWrongStakeAccount } =
      await claimSettlementInstruction({
        program,
        claimAmount: treeNode2Withdrawer1.treeNode.data.claim,
        index: treeNode2Withdrawer1Index,
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
    const { instruction: ixIndexOutOfBound } = await claimSettlementInstruction(
      {
        program,
        claimAmount: treeNode2Withdrawer1.treeNode.data.claim,
        index: 6,
        merkleProof: treeNode2Withdrawer1.proof,
        settlementAccount: settlementAccount2,
        stakeAccountFrom: stakeAccount1,
        stakeAccountTo: stakeAccountTreeNode2Withdrawer1,
        stakeAccountStaker: treeNode2Withdrawer1.treeNode.stakeAuthority,
        stakeAccountWithdrawer: treeNode2Withdrawer1.treeNode.withdrawAuthority,
      }
    )
    try {
      await provider.sendIx([], ixIndexOutOfBound)
      throw new Error('should have failed; index out of bound')
    } catch (e) {
      verifyError(e, Errors, 6065, 'index out of bounds')
    }

    const {
      instruction: treeNode2Withdrawer1Ix,
      settlementClaimsAccount: treeNode2SettlementClaimsAccount,
    } = await claimSettlementInstruction({
      program,
      claimAmount: treeNode2Withdrawer1.treeNode.data.claim,
      merkleProof: treeNode2Withdrawer1.proof,
      index: treeNode2Withdrawer1Index,
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
      settlementClaimsTreeNode2.bitmap.isSet(treeNode2Withdrawer1Index)
    ).toBe(true)

    await warpToNotBeClaimable()

    const [treeNode1Withdrawer3, treeNode1Withdrawer3Index] = treeNodeBy(
      voteAccount1,
      withdrawer3
    )
    const stakeAccountTreeNode1Withdrawer3 = await createDelegatedStakeAccount({
      provider,
      lamports: 11 * LAMPORTS_PER_SOL,
      voteAccount: voteAccount1,
      staker: treeNode1Withdrawer3.treeNode.stakeAuthority,
      withdrawer: treeNode1Withdrawer3.treeNode.withdrawAuthority,
    })
    const { instruction: ixTooLate } = await claimSettlementInstruction({
      program,
      claimAmount: treeNode1Withdrawer3.treeNode.data.claim,
      index: treeNode1Withdrawer3Index,
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
    expect(
      isClaimed(program, settlementAccount1, treeNode1Withdrawer3Index)
    ).rejects.toThrowError('Index 2 out of range')
  })

  async function warpToNotBeClaimable() {
    await warpOffsetEpoch(provider, epochsToClaimSettlement + 1)
  }
})

// https://github.com/solana-labs/solana/blob/v1.17.7/sdk/program/src/epoch_schedule.rs#L29C1-L29C45
// https://github.com/solana-labs/solana/blob/v1.17.7/sdk/program/src/epoch_schedule.rs#L167
async function getFirstSlotOfEpoch(
  provider: BankrunExtendedProvider,
  epoch: number
): Promise<bigint> {
  const epochBigInt = BigInt(epoch)
  const { slotsPerEpoch, firstNormalEpoch, firstNormalSlot } =
    provider.context.genesisConfig.epochSchedule
  let firstEpochSlot: bigint
  const MINIMUM_SLOTS_PER_EPOCH = 32
  if (epochBigInt <= firstNormalEpoch) {
    firstEpochSlot = BigInt((2 ** epoch - 1) * MINIMUM_SLOTS_PER_EPOCH)
  } else {
    firstEpochSlot =
      (epochBigInt - firstNormalEpoch) * slotsPerEpoch + firstNormalSlot
  }
  return firstEpochSlot
}
