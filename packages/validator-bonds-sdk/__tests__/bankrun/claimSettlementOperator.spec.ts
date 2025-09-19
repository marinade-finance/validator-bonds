import {
  Errors,
  ValidatorBondsProgram,
  claimSettlementV2Instruction,
  closeSettlementV2Instruction,
  getSettlementClaims,
  resetStakeInstruction,
  withdrawStakeInstruction,
} from '../../src'
import {
  BankrunExtendedProvider,
  assertNotExist,
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
  createSettlementFundedInitializedStake,
  createVoteAccount,
  createInitializedStakeAccount,
} from '../utils/staking'
import { createUserAndFund, pubkey } from '@marinade.finance/web3js-1x'
import {
  ITEMS_VOTE_ACCOUNT_1,
  MERKLE_ROOT_VOTE_ACCOUNT_1_BUF,
  configAccountKeypair,
  createWithdrawerUsers,
  totalClaimVoteAccount1,
  treeNodeByWithdrawer,
  withdrawer1,
} from '../utils/merkleTreeTestData'
import { verifyError } from '@marinade.finance/anchor-common'
import { initBankrunTest } from './bankrun'

describe('Validator Bonds claim settlement', () => {
  const epochsToClaimSettlement = 3
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let bondAccount: PublicKey
  let operatorAuthority: Keypair
  let validatorIdentity: Keypair
  let voteAccount: PublicKey
  let settlementAccount: PublicKey
  let settlementEpoch: bigint
  const maxMerkleNodes = 1

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
    ;({ configAccount, operatorAuthority } = await executeInitConfigInstruction(
      {
        program,
        provider,
        epochsToClaimSettlement,
        configAccountKeypair: configAccountKeypair,
      },
    ))
    ;({ voteAccount, validatorIdentity } = await createVoteAccount({
      provider,
    }))
    ;({ bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount,
      validatorIdentity: validatorIdentity,
    }))

    await warpToNextEpoch(provider)
    settlementEpoch = await currentEpoch(provider)
    ;({ settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: settlementEpoch,
      merkleRoot: MERKLE_ROOT_VOTE_ACCOUNT_1_BUF,
      maxMerkleNodes,
      maxTotalClaim: totalClaimVoteAccount1,
    }))
    await createWithdrawerUsers(provider)
  })

  it('claim settlement as operator with initialized stake account', async () => {
    const treeNode1Withdrawer1 = treeNodeByWithdrawer(
      ITEMS_VOTE_ACCOUNT_1,
      withdrawer1,
    )
    // note: initialized stake account cannot be deactivated as it's de-active from the start
    const stakeBefore = LAMPORTS_PER_SOL * 100
    const stakeAccount = await createSettlementFundedInitializedStake({
      program,
      provider,
      lamports: stakeBefore,
      configAccount,
      settlementAccount,
    })

    const stakeWithdrawerLamportsBefore = 14 * LAMPORTS_PER_SOL
    const { stakeAccount: stakeOperatorWithdrawer } =
      await createInitializedStakeAccount({
        provider,
        rentExempt: stakeWithdrawerLamportsBefore,
        staker: treeNode1Withdrawer1.treeNode.stakeAuthority,
        withdrawer: treeNode1Withdrawer1.treeNode.withdrawAuthority,
      })

    const { instruction, settlementClaimsAccount } =
      await claimSettlementV2Instruction({
        program,
        merkleProof: treeNode1Withdrawer1.proof,
        settlementAccount,
        stakeAccountFrom: stakeAccount,
        stakeAccountTo: stakeOperatorWithdrawer,
        stakeAccountStaker: treeNode1Withdrawer1.treeNode.stakeAuthority,
        stakeAccountWithdrawer: treeNode1Withdrawer1.treeNode.withdrawAuthority,
        claimAmount: treeNode1Withdrawer1.treeNode.claim,
        index: treeNode1Withdrawer1.treeNode.index,
      })

    await provider.sendIx([], instruction)

    const settlementClaims = await getSettlementClaims(
      program,
      settlementClaimsAccount,
    )
    expect(settlementClaims.account.settlement).toEqual(settlementAccount)
    expect(settlementClaims.account.maxRecords).toEqual(maxMerkleNodes)
    expect(settlementClaims.account.version).toEqual(0)
    expect(settlementClaims.bitmap.bitSet.counter).toEqual(1)
    expect(
      settlementClaims.bitmap.isSet(treeNode1Withdrawer1.treeNode.index),
    ).toBe(true)
    expect(
      (await provider.connection.getAccountInfo(stakeOperatorWithdrawer))
        ?.lamports,
    ).toEqual(
      treeNode1Withdrawer1.treeNode.claim.toNumber() +
        stakeWithdrawerLamportsBefore,
    )

    // closing the settlement
    await warpOffsetEpoch(provider, epochsToClaimSettlement + 1)
    const { instruction: closeSettlementIx } =
      await closeSettlementV2Instruction({
        program,
        settlementAccount,
        configAccount,
      })
    await provider.sendIx([], closeSettlementIx)
    await assertNotExist(provider, settlementAccount)
    await assertNotExist(provider, settlementClaimsAccount)

    // let's try to reset the operator based stake account
    const { instruction: resetStakeIx } = await resetStakeInstruction({
      program,
      stakeAccount,
      configAccount,
      settlementAccount,
      voteAccount,
      bondAccount,
    })
    try {
      await provider.sendIx([], resetStakeIx)
      throw new Error(
        'failure expected; cannot reset non-delegated stake accounts',
      )
    } catch (e) {
      verifyError(e, Errors, 6019, 'not delegated')
    }
    const withdrawToUser = pubkey(
      await createUserAndFund({ provider, lamports: LAMPORTS_PER_SOL }),
    )
    const { instruction: withdrawStakeIx } = await withdrawStakeInstruction({
      program,
      stakeAccount,
      configAccount,
      settlementAccount,
      withdrawTo: withdrawToUser,
      operatorAuthority,
    })
    await provider.sendIx([operatorAuthority], withdrawStakeIx)
    expect(
      (await provider.connection.getAccountInfo(withdrawToUser))?.lamports,
    ).toEqual(
      LAMPORTS_PER_SOL +
        stakeBefore -
        treeNode1Withdrawer1.treeNode.claim.toNumber(),
    )
  })
})
