import assert from 'assert'

import { getAnchorValidatorInfo } from '@marinade.finance/anchor-common'
import { executeTxSimple, transaction } from '@marinade.finance/web3js-1x'
import { createUserAndFund, signer } from '@marinade.finance/web3js-1x'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import BN from 'bn.js'

import {
  claimSettlementV2Instruction,
  fundSettlementInstruction,
  findSettlementClaims,
  parseCpiEvents,
  assertEvent,
  settlementClaimsAddress,
  isClaimed,
  CLAIM_SETTLEMENT_V2_EVENT,
} from '../../src'
import {
  MERKLE_ROOT_VOTE_ACCOUNT_1_BUF,
  configAccountKeypair,
  totalClaimVoteAccount1,
  treeNodeBy,
  treeNodesVoteAccount1,
  voteAccount1,
  voteAccount1Keypair,
  withdrawer1,
  withdrawer1Keypair,
  withdrawer2,
  withdrawer2Keypair,
  withdrawer3,
  withdrawer3Keypair,
} from '../utils/merkleTreeTestData'
import {
  createBondsFundedStakeAccount,
  createDelegatedStakeAccount,
  createVoteAccount,
} from '../utils/staking'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '../utils/testTransactions'
import { initTest } from '../utils/testValidator'

import type { ValidatorBondsProgram } from '../../src'
import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import type { Keypair, PublicKey } from '@solana/web3.js'

// NOTE: order of tests need to be maintained
describe('Validator Bonds claim settlement', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let operatorAuthority: Keypair
  let validatorIdentity: Keypair
  let settlementAccount: PublicKey
  let stakeAccount: PublicKey

  beforeAll(async () => {
    ;({ provider, program } = initTest())
    ;({ validatorIdentity } = await getAnchorValidatorInfo(provider.connection))
    ;({ configAccount, operatorAuthority } = await executeInitConfigInstruction(
      {
        program,
        provider,
        configAccountKeypair: configAccountKeypair,
        epochsToClaimSettlement: 1,
      },
    ))
    await createVoteAccount({
      voteAccount: voteAccount1Keypair,
      provider,
      validatorIdentity,
    })
    await executeInitBondInstruction({
      configAccount,
      program,
      provider,
      voteAccount: voteAccount1,
      validatorIdentity,
    })
    ;({ settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount: voteAccount1,
      operatorAuthority,
      merkleRoot: MERKLE_ROOT_VOTE_ACCOUNT_1_BUF,
      maxMerkleNodes: treeNodesVoteAccount1.length,
      maxTotalClaim: totalClaimVoteAccount1,
    }))
    stakeAccount = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount: configAccount,
      voteAccount: voteAccount1,
      lamports: totalClaimVoteAccount1.toNumber() + LAMPORTS_PER_SOL * 1111,
    })
    const { instruction: fundIx, splitStakeAccount } =
      await fundSettlementInstruction({
        program,
        settlementAccount,
        stakeAccount,
      })
    await provider.sendIx(
      [signer(splitStakeAccount), operatorAuthority],
      fundIx,
    )
  })

  it('claim settlement', async () => {
    await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL * 10,
      user: withdrawer1Keypair,
    })
    const treeNodeVoteAccount1Withdrawer1 = treeNodeBy(
      voteAccount1,
      withdrawer1,
    )
    const stakeAccountTreeNodeVoteAccount1Withdrawer1 =
      await createDelegatedStakeAccount({
        provider,
        lamports: 42 * LAMPORTS_PER_SOL,
        voteAccount: voteAccount1,
        staker: treeNodeVoteAccount1Withdrawer1.treeNode.stakeAuthority,
        withdrawer: treeNodeVoteAccount1Withdrawer1.treeNode.withdrawAuthority,
      })

    const tx = await transaction(provider)

    const { instruction, settlementClaimsAccount } =
      await claimSettlementV2Instruction({
        program,
        claimAmount: treeNodeVoteAccount1Withdrawer1.treeNode.claim,
        index: treeNodeVoteAccount1Withdrawer1.treeNode.index,
        merkleProof: treeNodeVoteAccount1Withdrawer1.proof,
        settlementAccount,
        stakeAccountFrom: stakeAccount,
        stakeAccountTo: stakeAccountTreeNodeVoteAccount1Withdrawer1,
      })
    tx.add(instruction)
    const executionReturn = await executeTxSimple(provider.connection, tx, [
      provider.wallet,
    ])

    const [settlementClaimsAddr] = settlementClaimsAddress(
      settlementAccount,
      program.programId,
    )
    expect(settlementClaimsAccount).toEqual(settlementClaimsAddr)

    expect(
      await isClaimed(
        program,
        settlementAccount,
        treeNodeVoteAccount1Withdrawer1.treeNode.index,
      ),
    ).toBeTruthy()

    const events = parseCpiEvents(program, executionReturn?.response)
    const e = assertEvent(events, CLAIM_SETTLEMENT_V2_EVENT)
    assert(e !== undefined)
    expect(e.settlement).toEqual(settlementAccount)
    expect(e.amount).toEqual(treeNodeVoteAccount1Withdrawer1.treeNode.claim)
    expect(e.index).toEqual(treeNodeVoteAccount1Withdrawer1.treeNode.index)
    expect(e.settlement).toEqual(settlementAccount)
    expect(e.settlementLamportsClaimed.old).toEqual(
      new BN(treeNodeVoteAccount1Withdrawer1.treeNode.claim).sub(
        treeNodeVoteAccount1Withdrawer1.treeNode.claim,
      ),
    )
    expect(e.settlementLamportsClaimed.new).toEqual(
      treeNodeVoteAccount1Withdrawer1.treeNode.claim,
    )
    expect(e.settlementMerkleNodesClaimed).toEqual(1)
    expect(e.stakeAccountStaker).toEqual(
      treeNodeVoteAccount1Withdrawer1.treeNode.stakeAuthority,
    )
    expect(e.stakeAccountWithdrawer).toEqual(
      treeNodeVoteAccount1Withdrawer1.treeNode.withdrawAuthority,
    )
    expect(e.stakeAccountTo).toEqual(
      stakeAccountTreeNodeVoteAccount1Withdrawer1,
    )
  })

  it('find claim settlements', async () => {
    await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL,
      user: withdrawer2Keypair,
    })
    const treeNodeWithdrawer2 = treeNodeBy(voteAccount1, withdrawer2)
    const stakeAccountTreeNodeWithdrawer2 = await createDelegatedStakeAccount({
      provider,
      lamports: 6 * LAMPORTS_PER_SOL,
      voteAccount: voteAccount1,
      staker: treeNodeWithdrawer2.treeNode.stakeAuthority,
      withdrawer: treeNodeWithdrawer2.treeNode.withdrawAuthority,
    })
    const { instruction: ix1 } = await claimSettlementV2Instruction({
      program,
      claimAmount: treeNodeWithdrawer2.treeNode.claim,
      index: treeNodeWithdrawer2.treeNode.index,
      merkleProof: treeNodeWithdrawer2.proof,
      settlementAccount,
      stakeAccountFrom: stakeAccount,
      stakeAccountTo: stakeAccountTreeNodeWithdrawer2,
    })
    await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL,
      user: withdrawer3Keypair,
    })
    const treeNodeWithdrawer3 = treeNodeBy(voteAccount1, withdrawer3)
    const stakeAccountTreeNodeWithdrawer3 = await createDelegatedStakeAccount({
      provider,
      lamports: 7 * LAMPORTS_PER_SOL,
      voteAccount: voteAccount1,
      staker: treeNodeWithdrawer3.treeNode.stakeAuthority,
      withdrawer: treeNodeWithdrawer3.treeNode.withdrawAuthority,
    })
    const { instruction: ix2 } = await claimSettlementV2Instruction({
      program,
      claimAmount: treeNodeWithdrawer3.treeNode.claim,
      index: treeNodeWithdrawer3.treeNode.index,
      merkleProof: treeNodeWithdrawer3.proof,
      settlementAccount,
      stakeAccountFrom: stakeAccount,
      stakeAccountTo: stakeAccountTreeNodeWithdrawer3,
    })

    await provider.sendIx([], ix1, ix2)

    const findSettlementList = await findSettlementClaims({
      program,
      settlement: settlementAccount,
    })
    expect(findSettlementList.length).toBeGreaterThanOrEqual(1)
    const findSettlementListAll = await findSettlementClaims({
      program,
    })
    expect(findSettlementListAll.length).toBeGreaterThanOrEqual(1)

    expect(
      await isClaimed(
        program,
        settlementAccount,
        treeNodeWithdrawer2.treeNode.index,
      ),
    ).toBeTruthy()
    expect(
      await isClaimed(
        program,
        settlementAccount,
        treeNodeWithdrawer3.treeNode.index,
      ),
    ).toBeTruthy()
  })
})
