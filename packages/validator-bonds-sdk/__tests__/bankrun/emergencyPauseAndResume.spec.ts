import {
  Config,
  Errors,
  ValidatorBondsProgram,
  claimSettlementV2Instruction,
  closeSettlementV2Instruction,
  configureBondInstruction,
  configureConfigInstruction,
  emergencyPauseInstruction,
  emergencyResumeInstruction,
  fundBondInstruction,
  fundSettlementInstruction,
  getConfig,
  initBondInstruction,
  initSettlementInstruction,
  initWithdrawRequestInstruction,
  mergeStakeInstruction,
  resetStakeInstruction,
  mintBondInstruction,
  configureBondWithMintInstruction,
  withdrawStakeInstruction,
  cancelSettlementInstruction,
  upsizeSettlementClaims,
  getSettlementClaims,
} from '../../src'
import {
  BankrunExtendedProvider,
  currentEpoch,
  warpOffsetEpoch,
  warpToNextEpoch,
} from '@marinade.finance/bankrun-utils'
import { executeInitConfigInstruction } from '../utils/testTransactions'
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Signer,
  Transaction,
  TransactionInstruction,
  TransactionInstructionCtorFields,
} from '@solana/web3.js'
import {
  createBondsFundedStakeAccount,
  createSettlementFundedDelegatedStake,
  createSettlementFundedInitializedStake,
  createDelegatedStakeAccount,
  createVoteAccount,
  delegatedStakeAccount,
} from '../utils/staking'
import { Wallet, signer } from '@marinade.finance/web3js-common'
import {
  MERKLE_ROOT_VOTE_ACCOUNT_1_BUF,
  configAccountKeypair,
  createWithdrawerUsers,
  totalClaimVoteAccount1,
  treeNodeBy,
  voteAccount1,
  voteAccount1Keypair,
  withdrawer1,
} from '../utils/merkleTreeTestData'
import { verifyError } from '@marinade.finance/anchor-common'
import { claimWithdrawRequestInstruction } from '../../src/instructions/claimWithdrawRequest'
import { initBankrunTest } from './bankrun'
import { isInitialized } from '../../src/settlementClaims'
import assert from 'assert'

describe('Validator Bonds pause&resume', () => {
  const epochsToClaimSettlement = BigInt(23)
  const withdrawLockupEpochs = BigInt(1)
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let adminAuthority: Keypair
  let pauseAuthority: Keypair
  let validatorIdentity: Keypair

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
    await warpToNextEpoch(provider)
    ;({
      configAccount,
      operatorAuthority: pauseAuthority,
      adminAuthority,
    } = await executeInitConfigInstruction({
      program,
      provider,
      epochsToClaimSettlement,
      withdrawLockupEpochs,
      configAccountKeypair: configAccountKeypair,
    }))
    const { instruction: configIx } = await configureConfigInstruction({
      program,
      configAccount,
      newPauseAuthority: pauseAuthority.publicKey,
    })
    await provider.sendIx([adminAuthority], configIx)
    ;({ validatorIdentity } = await createVoteAccount({
      voteAccount: voteAccount1Keypair,
      provider,
    }))
  })

  it('pause and resume validator bonds contract', async () => {
    let configData = await pause()

    // we can configure despite the pause
    expect(configData.pauseAuthority).toEqual(pauseAuthority.publicKey)
    expect(configData.operatorAuthority).toEqual(pauseAuthority.publicKey)
    const { instruction: configIx } = await configureConfigInstruction({
      program,
      configAccount,
      newOperator: adminAuthority.publicKey,
    })
    await provider.sendIx([adminAuthority], configIx)
    configData = await getConfig(program, configAccount)
    expect(configData.operatorAuthority).toEqual(adminAuthority.publicKey)

    const { instruction: initBondIx, bondAccount } = await initBondInstruction({
      program,
      configAccount,
      voteAccount: voteAccount1Keypair.publicKey,
      validatorIdentity: validatorIdentity.publicKey,
      bondAuthority: validatorIdentity.publicKey,
    })
    await verifyIsPaused([validatorIdentity], initBondIx)

    await resume()
    await provider.sendIx([validatorIdentity], initBondIx)

    await pause()
    const { instruction: configBondIx } = await configureBondInstruction({
      program,
      bondAccount,
      newCpmpe: 100,
      authority: validatorIdentity.publicKey,
    })
    await verifyIsPaused([validatorIdentity], configBondIx)

    await resume()
    await provider.sendIx([validatorIdentity], configBondIx)

    await pause()
    const { instruction: mintBondIx } = await mintBondInstruction({
      program,
      validatorIdentity: validatorIdentity.publicKey,
      bondAccount,
      configAccount,
      voteAccount: voteAccount1Keypair.publicKey,
    })
    await verifyIsPaused([], mintBondIx)

    await resume()
    await provider.sendIx([], mintBondIx)

    await pause()
    const { instruction: configureMintBondIx } =
      await configureBondWithMintInstruction({
        program,
        bondAccount,
        configAccount,
        tokenAuthority: validatorIdentity,
        newBondAuthority: adminAuthority.publicKey,
      })
    await verifyIsPaused([validatorIdentity], configureMintBondIx)

    await resume()
    await provider.sendIx([validatorIdentity], configureMintBondIx)

    const { stakeAccount: stakeAccountBond, withdrawer } =
      await delegatedStakeAccount({
        provider,
        lamports: LAMPORTS_PER_SOL * 300,
        voteAccountToDelegate: voteAccount1Keypair.publicKey,
      })
    let stakeAccount = stakeAccountBond

    await pause()
    const { instruction: fundBondIx } = await fundBondInstruction({
      program,
      configAccount,
      bondAccount,
      stakeAccount,
      stakeAccountAuthority: withdrawer,
    })
    await verifyIsPaused([withdrawer], fundBondIx)

    await resume()
    await provider.sendIx([withdrawer], fundBondIx)

    const stakeToMerge = await createBondsFundedStakeAccount({
      program,
      provider,
      lamports: LAMPORTS_PER_SOL * 2,
      configAccount,
      voteAccount: voteAccount1Keypair.publicKey,
    })

    await pause()
    const { instruction: mergeIx } = await mergeStakeInstruction({
      program,
      configAccount,
      sourceStakeAccount: stakeToMerge,
      destinationStakeAccount: stakeAccount,
    })
    await verifyIsPaused([], mergeIx)

    await resume()
    await provider.sendIx([], mergeIx)

    await pause()
    const initWithdrawerRequestEpoch = await currentEpoch(provider)
    const { instruction: initWithdrawIx, withdrawRequestAccount } =
      await initWithdrawRequestInstruction({
        program,
        configAccount,
        bondAccount,
        amount: LAMPORTS_PER_SOL * 10,
        authority: validatorIdentity,
        voteAccount: voteAccount1Keypair.publicKey,
      })
    await verifyIsPaused([validatorIdentity], initWithdrawIx)

    await resume()
    await provider.sendIx([validatorIdentity], initWithdrawIx)

    await pause()
    const { instruction: claimWithdrawIx, splitStakeAccount } =
      await claimWithdrawRequestInstruction({
        program,
        configAccount,
        bondAccount,
        withdrawRequestAccount,
        authority: validatorIdentity,
        voteAccount: voteAccount1Keypair.publicKey,
        stakeAccount,
      })
    await warpOffsetEpoch(
      provider,
      initWithdrawerRequestEpoch + withdrawLockupEpochs + BigInt(1),
    )
    await verifyIsPaused(
      [splitStakeAccount, validatorIdentity],
      claimWithdrawIx,
    )

    // the split stake account is the new stake account to be used in further instructions
    stakeAccount = splitStakeAccount.publicKey

    await resume()
    await provider.sendIx(
      [splitStakeAccount, validatorIdentity],
      claimWithdrawIx,
    )

    await pause()
    const settlementEpoch = await currentEpoch(provider)
    const {
      instruction: initSettlementIx,
      settlementAccount,
      settlementClaimsAccount,
    } = await initSettlementInstruction({
      program,
      configAccount,
      operatorAuthority: adminAuthority.publicKey,
      merkleRoot: MERKLE_ROOT_VOTE_ACCOUNT_1_BUF,
      maxMerkleNodes: 10 * 1024 * 8,
      maxTotalClaim: totalClaimVoteAccount1,
      voteAccount: voteAccount1,
      bondAccount,
      epoch: settlementEpoch,
    })
    await verifyIsPaused([adminAuthority], initSettlementIx)

    await resume()
    await provider.sendIx([adminAuthority], initSettlementIx)

    await pause()

    const settlementClaimsAccountInfo =
      await provider.connection.getAccountInfo(settlementClaimsAccount)
    assert(settlementClaimsAccountInfo !== null)
    expect(isInitialized(program, settlementClaimsAccountInfo)).toBe(false)

    const { instruction: upsizeIx } = await upsizeSettlementClaims({
      program,
      settlementClaimsAccount,
    })
    // not blocked by pause
    await provider.sendIx([], upsizeIx)

    // when account is decoded it should be initialized
    await getSettlementClaims(program, settlementClaimsAccount)

    const {
      instruction: fundSettlementIx,
      splitStakeAccount: settlementSplitStake,
    } = await fundSettlementInstruction({
      program,
      settlementAccount,
      stakeAccount,
      operatorAuthority: adminAuthority,
    })

    await verifyIsPaused(
      [adminAuthority, settlementSplitStake],
      fundSettlementIx,
    )

    await resume()
    await provider.sendIx(
      [adminAuthority, signer(settlementSplitStake)],
      fundSettlementIx,
    )

    await pause()
    await createWithdrawerUsers(provider)
    const treeNode1Withdrawer1 = treeNodeBy(voteAccount1, withdrawer1)
    const stakeAccountSettlementWithdrawer = await createDelegatedStakeAccount({
      provider,
      lamports: 3 * LAMPORTS_PER_SOL,
      voteAccount: voteAccount1,
      staker: treeNode1Withdrawer1.treeNode.stakeAuthority,
      withdrawer: treeNode1Withdrawer1.treeNode.withdrawAuthority,
    })
    await warpToNextEpoch(provider)
    const { instruction: claimIx } = await claimSettlementV2Instruction({
      program,
      claimAmount: treeNode1Withdrawer1.treeNode.data.claim,
      index: treeNode1Withdrawer1.treeNode.index,
      merkleProof: treeNode1Withdrawer1.proof,
      settlementAccount,
      stakeAccountFrom: stakeAccount,
      stakeAccountTo: stakeAccountSettlementWithdrawer,
      stakeAccountStaker: treeNode1Withdrawer1.treeNode.stakeAuthority,
      stakeAccountWithdrawer: treeNode1Withdrawer1.treeNode.withdrawAuthority,
    })

    await verifyIsPaused([], claimIx)

    await resume()
    await provider.sendIx([], claimIx)

    await pause()
    await warpOffsetEpoch(
      provider,
      initWithdrawerRequestEpoch + epochsToClaimSettlement + BigInt(1),
    )
    const { instruction: closeSettlementIx } =
      await closeSettlementV2Instruction({
        program,
        settlementAccount,
        configAccount,
        bondAccount,
        voteAccount: voteAccount1,
        splitRentRefundAccount: stakeAccount,
      })
    await verifyIsPaused([], closeSettlementIx)

    const { instruction: cancelSettlementIx } =
      await cancelSettlementInstruction({
        program,
        settlementAccount,
        configAccount,
        bondAccount,
        voteAccount: voteAccount1,
        splitRentRefundAccount: stakeAccount,
        authority: adminAuthority,
      })
    await verifyIsPaused([adminAuthority], cancelSettlementIx)

    await resume()
    await provider.sendIx([], closeSettlementIx)

    await pause()
    await warpOffsetEpoch(
      provider,
      initWithdrawerRequestEpoch + epochsToClaimSettlement + BigInt(1),
    )

    await createSettlementFundedDelegatedStake({
      program,
      provider,
      lamports: LAMPORTS_PER_SOL * 2,
      voteAccount: voteAccount1,
      configAccount,
      settlementAccount: settlementAccount,
    })
    const { instruction: resetIx } = await resetStakeInstruction({
      program,
      configAccount,
      bondAccount,
      voteAccount: voteAccount1,
      stakeAccount,
      settlementAccount,
    })
    await verifyIsPaused([], resetIx)

    await resume()
    await provider.sendIx([], resetIx)

    await pause()
    const createInitializedStakeAccount =
      await createSettlementFundedInitializedStake({
        program,
        provider,
        configAccount,
        settlementAccount: settlementAccount,
        lamports: LAMPORTS_PER_SOL,
      })
    const { instruction: withdrawIx } = await withdrawStakeInstruction({
      program,
      configAccount,
      stakeAccount: createInitializedStakeAccount,
      operatorAuthority: adminAuthority.publicKey,
      settlementAccount,
      withdrawTo: provider.walletPubkey,
    })
    await verifyIsPaused([adminAuthority], withdrawIx)

    await resume()
    await provider.sendIx([adminAuthority], withdrawIx)
  })

  async function pause(isWarp = true): Promise<Config> {
    const { instruction } = await emergencyPauseInstruction({
      program,
      configAccount,
      pauseAuthority: pauseAuthority.publicKey,
    })
    isWarp && (await warpToNextEpoch(provider))
    await provider.sendIx([pauseAuthority], instruction)
    const configData = await getConfig(program, configAccount)
    expect(configData.paused).toEqual(true)
    return configData
  }

  async function resume(isWarp = true): Promise<Config> {
    const { instruction } = await emergencyResumeInstruction({
      program,
      configAccount,
      pauseAuthority: pauseAuthority.publicKey,
    })
    isWarp && (await warpToNextEpoch(provider))
    await provider.sendIx([pauseAuthority], instruction)
    const configData = await getConfig(program, configAccount)
    expect(configData.paused).toEqual(false)
    return configData
  }

  async function verifyIsPaused(
    signers: (Keypair | Signer | Wallet | PublicKey)[],
    ...ixes: (
      | Transaction
      | TransactionInstruction
      | TransactionInstructionCtorFields
    )[]
  ) {
    try {
      await provider.sendIx(
        signers.map(s => signer(s)),
        ...ixes,
      )
      throw new Error('Failure expected; the contract is paused')
    } catch (e) {
      verifyError(e, Errors, 6054, 'Pause is Active')
    }
  }
})
