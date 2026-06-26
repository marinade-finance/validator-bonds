import {
  currentEpoch,
  warpOffsetEpoch,
  warpToNextEpoch,
} from '@marinade.finance/bankrun-utils'
import { signer } from '@marinade.finance/web3js-1x'
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js'

import { initBankrunTest } from './bankrun'
import {
  bondsWithdrawerAuthority,
  claimSettlementV2Instruction,
  fundSettlementInstruction,
  getSettlement,
  isClaimed,
  settlementStakerAuthority,
  swapSettlementStakeInstruction,
} from '../../src'
import {
  MERKLE_ROOT_VOTE_ACCOUNT_1_BUF,
  configAccountKeypair,
  createWithdrawerUsers,
  totalClaimVoteAccount1,
  treeNodeBy,
  voteAccount1Keypair,
  withdrawer1,
} from '../utils/merkleTreeTestData'
import {
  StakeStates,
  createBondsFundedStakeAccount,
  createDelegatedStakeAccount,
  createInitializedStakeAccount,
  createVoteAccount,
  getAndCheckStakeAccount,
} from '../utils/staking'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '../utils/testTransactions'

import type { ValidatorBondsProgram } from '../../src'
import type { BankrunExtendedProvider } from '@marinade.finance/bankrun-utils'
import type { PublicKey } from '@solana/web3.js'

// The grand-account reserve lifecycle: a swap hands the settlement's deactivating
// bond stake to the marinade reserve wallet. Once it has cooled to fully
// deactivated, the reserve reuses that very stake as the swap input for a later
// settlement — re-delegated to the validator and instantly deactivated again,
// claimable the same epoch. This is what lets the reserve recycle one pool of
// stake across epochs instead of needing fresh lamports every time.
describe('Validator Bonds swap settlement stake — reserve reuse across cycles', () => {
  const epochsToClaimSettlement = 4
  const slotsToStartSettlementClaiming = 5
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let operatorAuthority: Keypair
  let voteAccount: PublicKey
  let validatorIdentity: Keypair

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
  })

  beforeEach(async () => {
    ;({ configAccount, operatorAuthority } = await executeInitConfigInstruction(
      {
        program,
        provider,
        epochsToClaimSettlement,
        slotsToStartSettlementClaiming,
        configAccountKeypair,
      },
    ))
    ;({ voteAccount, validatorIdentity } = await createVoteAccount({
      voteAccount: voteAccount1Keypair,
      provider,
    }))
    await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount,
      validatorIdentity,
    })
  })

  it('reuses the deactivated stake received from one swap as the next swap input', async () => {
    const [bondAuth] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
    )
    // models the marinade reserve wallet: provides the swap input and receives
    // the settlement's deactivating bond stake in return
    const reserveAuthority = Keypair.generate()

    // ===== CYCLE 1: a swap hands a deactivating bond stake to the reserve =====
    const bondStake1 = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      voteAccount,
      lamports: totalClaimVoteAccount1.toNumber() + 5 * LAMPORTS_PER_SOL,
    })
    await warpToNextEpoch(provider) // activate the bond stake

    const { settlementAccount: settlement1 } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: await currentEpoch(provider),
      merkleRoot: MERKLE_ROOT_VOTE_ACCOUNT_1_BUF,
      maxMerkleNodes: 1,
      maxTotalClaim: totalClaimVoteAccount1,
    })
    const { instruction: fundIx1, splitStakeAccount: split1 } =
      await fundSettlementInstruction({
        program,
        settlementAccount: settlement1,
        stakeAccount: bondStake1,
      })
    await provider.sendIx([signer(split1), operatorAuthority], fundIx1)
    const reserveLamports = (await provider.connection.getAccountInfo(
      bondStake1,
    ))!.lamports

    // the reserve provides a fresh stake of equal value (cold start)
    const { stakeAccount: reserveStake1 } = await createInitializedStakeAccount(
      {
        provider,
        rentExempt: reserveLamports,
        staker: reserveAuthority,
        withdrawer: reserveAuthority,
      },
    )
    const { instruction: swapIx1 } = await swapSettlementStakeInstruction({
      program,
      settlementAccount: settlement1,
      settlementStake: bondStake1,
      userStake: reserveStake1,
      userAuthority: reserveAuthority,
    })
    await provider.sendIx([reserveAuthority, operatorAuthority], swapIx1)

    // the reserve now owns the original bond stake — delegated to the validator
    // and deactivating (exactly the state the operator wallet ends up holding)
    const [receivedState] = await getAndCheckStakeAccount(
      provider,
      bondStake1,
      StakeStates.Delegated,
    )
    expect(receivedState.Stake!.meta.authorized.staker).toEqual(
      reserveAuthority.publicKey,
    )
    expect(receivedState.Stake!.meta.authorized.withdrawer).toEqual(
      reserveAuthority.publicKey,
    )

    // ===== let the received stake cool to fully deactivated =====
    await warpOffsetEpoch(provider, 2)

    // ===== CYCLE 2: reuse that stake as the swap input for a new settlement =====
    const bondStake2 = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      voteAccount,
      lamports: totalClaimVoteAccount1.toNumber() + 5 * LAMPORTS_PER_SOL,
    })
    await warpToNextEpoch(provider) // activate the second bond stake
    const cycle2Epoch = await currentEpoch(provider)

    const { settlementAccount: settlement2 } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: cycle2Epoch,
      // distinct settlement: same root, later epoch -> different PDA than cycle 1
      merkleRoot: MERKLE_ROOT_VOTE_ACCOUNT_1_BUF,
      maxMerkleNodes: 1,
      maxTotalClaim: totalClaimVoteAccount1,
    })
    const [settlementAuth2] = settlementStakerAuthority(
      settlement2,
      program.programId,
    )
    const { instruction: fundIx2, splitStakeAccount: split2 } =
      await fundSettlementInstruction({
        program,
        settlementAccount: settlement2,
        stakeAccount: bondStake2,
      })
    await provider.sendIx([signer(split2), operatorAuthority], fundIx2)
    const settlement2Lamports = (await provider.connection.getAccountInfo(
      bondStake2,
    ))!.lamports
    // identical funding -> the reused reserve stake matches by construction
    expect(settlement2Lamports).toEqual(reserveLamports)

    // the swap input is the deactivated bond stake received in cycle 1
    const { instruction: swapIx2 } = await swapSettlementStakeInstruction({
      program,
      settlementAccount: settlement2,
      settlementStake: bondStake2,
      userStake: bondStake1,
      userAuthority: reserveAuthority,
    })
    await provider.sendIx([reserveAuthority, operatorAuthority], swapIx2)

    // the reused stake is re-delegated to the validator + deactivated THIS epoch,
    // now owned by settlement 2 -> immediately claimable, reaps to the bond
    const [reusedState] = await getAndCheckStakeAccount(
      provider,
      bondStake1,
      StakeStates.Delegated,
    )
    expect(reusedState.Stake!.meta.authorized.staker).toEqual(settlementAuth2)
    expect(reusedState.Stake!.meta.authorized.withdrawer).toEqual(bondAuth)
    expect(reusedState.Stake!.stake.delegation.voterPubkey).toEqual(voteAccount)
    expect(reusedState.Stake!.stake.delegation.deactivationEpoch).toEqual(
      cycle2Epoch,
    )

    // and it is genuinely claimable in the SAME epoch from the reused stake
    const treeNode = treeNodeBy(voteAccount, withdrawer1)
    const settlement2Slot = (await getSettlement(program, settlement2))
      .slotCreatedAt
    provider.context.warpToSlot(
      BigInt(settlement2Slot.toString()) +
        BigInt(slotsToStartSettlementClaiming),
    )
    await createWithdrawerUsers(provider)
    const claimToStake = await createDelegatedStakeAccount({
      provider,
      lamports: 3 * LAMPORTS_PER_SOL,
      voteAccount,
      staker: treeNode.treeNode.stakeAuthority,
      withdrawer: treeNode.treeNode.withdrawAuthority,
    })
    const claimToBefore = (await provider.connection.getAccountInfo(
      claimToStake,
    ))!.lamports
    const { instruction: claimIx } = await claimSettlementV2Instruction({
      program,
      claimAmount: treeNode.treeNode.claim,
      index: treeNode.treeNode.index,
      merkleProof: treeNode.proof,
      settlementAccount: settlement2,
      stakeAccountFrom: bondStake1, // the reused, settlement-owned stake
      stakeAccountTo: claimToStake,
      stakeAccountStaker: treeNode.treeNode.stakeAuthority,
      stakeAccountWithdrawer: treeNode.treeNode.withdrawAuthority,
    })
    await provider.sendIx([], claimIx)

    expect(
      await isClaimed(program, settlement2, treeNode.treeNode.index),
    ).toBeTruthy()
    const claimToAfter = (await provider.connection.getAccountInfo(
      claimToStake,
    ))!.lamports
    expect(claimToAfter - claimToBefore).toEqual(
      treeNode.treeNode.claim.toNumber(),
    )
  })
})
