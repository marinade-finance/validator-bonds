import { verifyError } from '@marinade.finance/anchor-common'
import { currentEpoch, warpToNextEpoch } from '@marinade.finance/bankrun-utils'
import {
  U64_MAX,
  createUserAndFund,
  pubkey,
  signer,
} from '@marinade.finance/web3js-1x'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'

import {
  initBankrunTest,
  StakeActivationState,
  stakeActivation,
  warpOffsetSlot,
} from './bankrun'
import {
  Errors,
  bondsWithdrawerAuthority,
  claimSettlementV2Instruction,
  emergencyPauseInstruction,
  fundSettlementInstruction,
  getSettlement,
  settlementStakerAuthority,
  swapSettlementStakeInstruction,
} from '../../src'
import {
  MERKLE_ROOT_VOTE_ACCOUNT_1_BUF,
  configAccountKeypair,
  totalClaimVoteAccount1,
  treeNodeBy,
  voteAccount1Keypair,
  withdrawer1,
} from '../utils/merkleTreeTestData'
import {
  StakeStates,
  createBondsFundedStakeAccount,
  createDelegatedStakeAccount,
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
import type { Keypair, PublicKey } from '@solana/web3.js'

describe('Validator Bonds swap settlement stake', () => {
  const epochsToClaimSettlement = 3
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let adminAuthority: Keypair
  let operatorAuthority: Keypair
  let validatorIdentity: Keypair
  let voteAccount: PublicKey
  let settlementEpoch: bigint

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
  })

  beforeEach(async () => {
    ;({ configAccount, adminAuthority, operatorAuthority } =
      await executeInitConfigInstruction({
        program,
        provider,
        epochsToClaimSettlement,
      }))
    ;({ voteAccount, validatorIdentity } = await createVoteAccount({
      provider,
    }))
    await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount,
      validatorIdentity,
    })
    settlementEpoch = await currentEpoch(provider)
  })

  // funds a settlement with an active stake account (moving it from bond to settlement authority)
  async function fundSettlementWithActiveStake(
    settlementAccount: PublicKey,
    lamports: number,
  ): Promise<PublicKey> {
    const stakeAccount = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      voteAccount,
      lamports,
    })
    await warpToNextEpoch(provider) // activate the stake account
    const { instruction, splitStakeAccount } = await fundSettlementInstruction({
      program,
      settlementAccount,
      stakeAccount,
    })
    await provider.sendIx(
      [signer(splitStakeAccount), operatorAuthority],
      instruction,
    )
    return stakeAccount
  }

  it('swaps an active funded stake for an immediately inactive one', async () => {
    const maxTotalClaim = LAMPORTS_PER_SOL * 10
    const { settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: settlementEpoch,
      maxTotalClaim,
    })

    const stakeAccount = await fundSettlementWithActiveStake(
      settlementAccount,
      maxTotalClaim + 5 * LAMPORTS_PER_SOL,
    )
    const lamportsFundedBefore = (
      await getSettlement(program, settlementAccount)
    ).lamportsFunded
    expect(lamportsFundedBefore.toNumber()).toBeGreaterThan(0)
    const stakeLamports = (
      await provider.connection.getAccountInfo(stakeAccount)
    )?.lamports
    expect(stakeLamports).toBeGreaterThan(0)

    const caller = await createUserAndFund({
      provider,
      lamports: stakeLamports! + LAMPORTS_PER_SOL,
    })
    const { instruction, newStakeAccount } =
      await swapSettlementStakeInstruction({
        program,
        settlementAccount,
        stakeAccount,
        caller: pubkey(caller),
      })
    await provider.sendIx([signer(caller)], instruction)

    // the 1:1 swap must leave the settlement funding untouched
    expect(
      (
        await getSettlement(program, settlementAccount)
      ).lamportsFunded.toNumber(),
    ).toEqual(lamportsFundedBefore.toNumber())

    // the caller walks away with the original active stake account (both authorities)
    const [originalStake] = await getAndCheckStakeAccount(
      provider,
      stakeAccount,
      StakeStates.Delegated,
    )
    expect(originalStake.Stake?.meta.authorized.staker).toEqual(pubkey(caller))
    expect(originalStake.Stake?.meta.authorized.withdrawer).toEqual(
      pubkey(caller),
    )

    // the replacement looks exactly like a funded settlement stake
    const [newStake] = await getAndCheckStakeAccount(
      provider,
      newStakeAccount,
      StakeStates.Delegated,
    )
    const [settlementAuth] = settlementStakerAuthority(
      settlementAccount,
      program.programId,
    )
    const [bondsAuth] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
    )
    expect(newStake.Stake?.meta.authorized.staker).toEqual(settlementAuth)
    expect(newStake.Stake?.meta.authorized.withdrawer).toEqual(bondsAuth)
    expect(newStake.Stake?.stake.delegation.voterPubkey).toEqual(voteAccount)
    expect(
      (await provider.connection.getAccountInfo(newStakeAccount))?.lamports,
    ).toEqual(stakeLamports)

    // delegated and deactivated within the same epoch => never effective => withdrawable at once
    const executionEpoch = await currentEpoch(provider)
    expect(newStake.Stake?.stake.delegation.activationEpoch).toEqual(
      executionEpoch,
    )
    expect(newStake.Stake?.stake.delegation.deactivationEpoch).toEqual(
      executionEpoch,
    )
    expect(newStake.Stake?.stake.delegation.deactivationEpoch).not.toEqual(
      U64_MAX,
    )
    expect(await stakeActivation(provider, newStakeAccount)).toEqual(
      StakeActivationState.Deactivated,
    )
  })

  it('cannot swap a stake that is not funded to the settlement', async () => {
    const { settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: settlementEpoch,
      maxTotalClaim: LAMPORTS_PER_SOL * 10,
    })

    // a bond-funded stake account has the bonds withdrawer authority as staker, not the settlement authority
    const bondStakeAccount = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      voteAccount,
      lamports: 2 * LAMPORTS_PER_SOL,
    })
    await warpToNextEpoch(provider)

    const caller = await createUserAndFund({
      provider,
      lamports: 3 * LAMPORTS_PER_SOL,
    })
    const { instruction } = await swapSettlementStakeInstruction({
      program,
      settlementAccount,
      stakeAccount: bondStakeAccount,
      caller: pubkey(caller),
    })
    try {
      await provider.sendIx([signer(caller)], instruction)
      throw new Error('should have failed; stake not funded to settlement')
    } catch (e) {
      verifyError(e, Errors, 6036, 'not funded under the settlement')
    }
  })

  it('cannot swap when the program is paused', async () => {
    const { settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: settlementEpoch,
      maxTotalClaim: LAMPORTS_PER_SOL * 10,
    })
    const stakeAccount = await fundSettlementWithActiveStake(
      settlementAccount,
      5 * LAMPORTS_PER_SOL,
    )

    const { instruction: pauseIx } = await emergencyPauseInstruction({
      program,
      configAccount,
      pauseAuthority: adminAuthority.publicKey,
    })
    await provider.sendIx([adminAuthority], pauseIx)

    const caller = await createUserAndFund({
      provider,
      lamports: 6 * LAMPORTS_PER_SOL,
    })
    const { instruction } = await swapSettlementStakeInstruction({
      program,
      settlementAccount,
      stakeAccount,
      caller: pubkey(caller),
    })
    try {
      await provider.sendIx([signer(caller)], instruction)
      throw new Error('should have failed; program is paused')
    } catch (e) {
      verifyError(e, Errors, 6054, 'Emergency Pause is Active')
    }
  })

  it('cannot swap a stake that already finished deactivating', async () => {
    const { settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: settlementEpoch,
      maxTotalClaim: LAMPORTS_PER_SOL * 10,
    })
    const stakeAccount = await fundSettlementWithActiveStake(
      settlementAccount,
      5 * LAMPORTS_PER_SOL,
    )
    // let the funded stake fully deactivate (deactivation_epoch < current epoch)
    await warpToNextEpoch(provider)

    const caller = await createUserAndFund({
      provider,
      lamports: 6 * LAMPORTS_PER_SOL,
    })
    const { instruction } = await swapSettlementStakeInstruction({
      program,
      settlementAccount,
      stakeAccount,
      caller: pubkey(caller),
    })
    try {
      await provider.sendIx([signer(caller)], instruction)
      throw new Error('should have failed; stake already finished deactivating')
    } catch (e) {
      verifyError(e, Errors, 6079, 'only within the epoch it was deactivated')
    }
  })
})

describe('Validator Bonds swap settlement stake enables same-epoch claiming', () => {
  const epochsToClaimSettlement = 4
  // small enough that the claiming window opens within the epoch the swap happens
  const slotsToStartSettlementClaiming = 5
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let operatorAuthority: Keypair
  let voteAccount: PublicKey

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
    ;({ configAccount, operatorAuthority } = await executeInitConfigInstruction(
      {
        program,
        provider,
        epochsToClaimSettlement,
        slotsToStartSettlementClaiming: BigInt(slotsToStartSettlementClaiming),
        configAccountKeypair,
      },
    ))
    const { validatorIdentity } = await createVoteAccount({
      provider,
      voteAccount: voteAccount1Keypair,
    })
    voteAccount = voteAccount1Keypair.publicKey
    await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount,
      validatorIdentity,
    })
  })

  it('claims from the swapped stake in the same epoch the swap happened', async () => {
    // a bond stake activated before funding, so fund_settlement deactivates it in the funding epoch
    const bondStake = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      voteAccount,
      lamports: totalClaimVoteAccount1.toNumber() + 5 * LAMPORTS_PER_SOL,
    })
    await warpToNextEpoch(provider) // activate

    const settlementEpoch = await currentEpoch(provider)
    const { settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: settlementEpoch,
      merkleRoot: MERKLE_ROOT_VOTE_ACCOUNT_1_BUF,
      maxMerkleNodes: 1,
      maxTotalClaim: totalClaimVoteAccount1,
    })

    // fund_settlement deactivates the stake within the current epoch
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

    const stakeLamports = (await provider.connection.getAccountInfo(bondStake))
      ?.lamports
    const caller = await createUserAndFund({
      provider,
      lamports: stakeLamports! + LAMPORTS_PER_SOL,
    })
    const { instruction: swapIx, newStakeAccount } =
      await swapSettlementStakeInstruction({
        program,
        settlementAccount,
        stakeAccount: bondStake,
        caller: pubkey(caller),
      })
    await provider.sendIx([signer(caller)], swapIx)

    const swapEpoch = await currentEpoch(provider)
    expect(await stakeActivation(provider, newStakeAccount)).toEqual(
      StakeActivationState.Deactivated,
    )

    // pass the claiming-start slot gate; a small offset stays within the same epoch
    await warpOffsetSlot(provider, slotsToStartSettlementClaiming + 1)

    // claim from the freshly swapped-in stake within the very same epoch
    const treeNode = treeNodeBy(voteAccount, withdrawer1)
    const stakeAccountTo = await createDelegatedStakeAccount({
      provider,
      lamports: 3 * LAMPORTS_PER_SOL,
      voteAccount,
      staker: treeNode.treeNode.stakeAuthority,
      withdrawer: treeNode.treeNode.withdrawAuthority,
    })
    const { instruction: claimIx } = await claimSettlementV2Instruction({
      program,
      claimAmount: treeNode.treeNode.claim,
      index: treeNode.treeNode.index,
      merkleProof: treeNode.proof,
      settlementAccount,
      stakeAccountFrom: newStakeAccount,
      stakeAccountTo,
      stakeAccountStaker: treeNode.treeNode.stakeAuthority,
      stakeAccountWithdrawer: treeNode.treeNode.withdrawAuthority,
    })

    const stakeToBefore = (
      await provider.connection.getAccountInfo(stakeAccountTo)
    )?.lamports
    await provider.sendIx([], claimIx)

    // no epoch boundary was crossed between funding the swap and claiming
    expect(await currentEpoch(provider)).toEqual(swapEpoch)
    expect(
      (await provider.connection.getAccountInfo(stakeAccountTo))?.lamports,
    ).toEqual(stakeToBefore! + treeNode.treeNode.claim.toNumber())
    expect(
      (
        await getSettlement(program, settlementAccount)
      ).lamportsClaimed.toNumber(),
    ).toEqual(treeNode.treeNode.claim.toNumber())
  })
})
