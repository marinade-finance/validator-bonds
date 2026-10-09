import {
  currentEpoch,
  warpOffsetEpoch,
  warpToNextEpoch,
} from '@marinade.finance/bankrun-utils'
import { signer, pubkey } from '@marinade.finance/web3js-1x'
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js'

import { initBankrunTest } from './bankrun'
import {
  bondsWithdrawerAuthority,
  claimSettlementV2Instruction,
  closeSettlementV2Instruction,
  fundSettlementInstruction,
  getSettlement,
  isClaimed,
  resetStakeInstruction,
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

// End-to-end: a settlement funded with a (still-deactivating) bond stake is made
// immediately claimable by swapping in a user stake, claimed in the SAME epoch,
// and at close the swapped-in stake reaps back to the validator's bond.
describe('Validator Bonds swap settlement stake — full flow', () => {
  const epochsToClaimSettlement = 4
  const slotsToStartSettlementClaiming = 5
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let operatorAuthority: Keypair
  let voteAccount: PublicKey
  let validatorIdentity: Keypair
  let bondAccount: PublicKey

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
    ;({ bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount,
      validatorIdentity,
    }))
  })

  it('fund -> swap -> claim (same epoch) -> close reaps to bond', async () => {
    const [bondAuth] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
    )
    const treeNode = treeNodeBy(voteAccount, withdrawer1)

    // an activated bond stake (created and warped to active before the settlement,
    // so the settlement slot — and its claim window — are in the future)
    const bondStake = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      voteAccount,
      lamports: totalClaimVoteAccount1.toNumber() + 5 * LAMPORTS_PER_SOL,
    })
    await warpToNextEpoch(provider) // activate the bond stake

    // settlement created for the fixture merkle root in the current epoch
    const { settlementAccount } = await executeInitSettlement({
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
    const [settlementAuth] = settlementStakerAuthority(
      settlementAccount,
      program.programId,
    )

    // fund the settlement with the bond stake -> deactivating settlement stake
    const { instruction: fundIx, splitStakeAccount } =
      await fundSettlementInstruction({
        program,
        settlementAccount,
        stakeAccount: bondStake,
      })
    await provider.sendIx(
      [signer(splitStakeAccount), operatorAuthority],
      fundIx,
    )
    const settlementStakeLamports = (await provider.connection.getAccountInfo(
      bondStake,
    ))!.lamports

    // swap in a user-provided undelegated stake of equal value
    const userAuthority = Keypair.generate()
    const { stakeAccount: userStake } = await createInitializedStakeAccount({
      provider,
      rentExempt: settlementStakeLamports,
      staker: userAuthority,
      withdrawer: userAuthority,
    })
    const { instruction: swapIx } = await swapSettlementStakeInstruction({
      program,
      settlementAccount,
      settlementStake: bondStake,
      userStake,
      userAuthority,
    })
    await provider.sendIx([userAuthority, operatorAuthority], swapIx)

    // open the claim window (same epoch) and CLAIM from the swapped-in stake
    const settlementSlot = (await getSettlement(program, settlementAccount))
      .slotCreatedAt
    provider.context.warpToSlot(
      BigInt(settlementSlot.toString()) +
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
      settlementAccount,
      stakeAccountFrom: userStake, // the swapped-in stake, now settlement-owned
      stakeAccountTo: claimToStake,
      stakeAccountStaker: treeNode.treeNode.stakeAuthority,
      stakeAccountWithdrawer: treeNode.treeNode.withdrawAuthority,
    })
    await provider.sendIx([], claimIx)

    // the claim succeeded in the SAME epoch as the swap — the swapped-in stake
    // was immediately withdrawable despite the bond stake never deactivating
    expect(
      await isClaimed(program, settlementAccount, treeNode.treeNode.index),
    ).toBeTruthy()
    const claimToAfter = (await provider.connection.getAccountInfo(
      claimToStake,
    ))!.lamports
    expect(claimToAfter - claimToBefore).toEqual(
      treeNode.treeNode.claim.toNumber(),
    )

    // close after the claim window, then reset the swapped-in stake — it reaps
    // back to the validator's bond (delegated to the validator), not to marinade
    await warpOffsetEpoch(provider, epochsToClaimSettlement + 1)
    const { instruction: closeIx } = await closeSettlementV2Instruction({
      program,
      settlementAccount,
      // the swapped-in stake is the settlement-owned stake for the split-rent
      // refund (passed explicitly so the builder skips a getProgramAccounts scan
      // that bankrun does not support)
      splitRentRefundAccount: userStake,
    })
    await provider.sendIx([], closeIx)

    const { instruction: resetIx } = await resetStakeInstruction({
      program,
      settlementAccount,
      stakeAccount: userStake,
      configAccount,
      bondAccount,
      voteAccount,
    })
    await provider.sendIx([], resetIx)

    const [resetState] = await getAndCheckStakeAccount(
      provider,
      userStake,
      StakeStates.Delegated,
    )
    // reaped to the bond: staker/withdrawer back to the bonds authority,
    // delegated to the validator
    expect(resetState.Stake!.meta.authorized.staker).toEqual(bondAuth)
    expect(resetState.Stake!.meta.authorized.withdrawer).toEqual(bondAuth)
    expect(resetState.Stake!.stake.delegation.voterPubkey).toEqual(voteAccount)
    expect(pubkey(settlementAuth)).not.toEqual(bondAuth)
  })
})
