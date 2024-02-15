import {
  Config,
  Errors,
  MerkleTreeNode,
  SETTLEMENT_CLAIM_SEED,
  ValidatorBondsProgram,
  claimSettlementInstruction,
  fundSettlementInstruction,
  getConfig,
  getSettlementClaim,
  settlementClaimAddress,
  withdrawerAuthority,
} from '../../src'
import {
  BankrunExtendedProvider,
  assertNotExist,
  currentEpoch,
  initBankrunTest,
  warpOffsetEpoch,
  warpToNextEpoch,
} from './bankrun'
import {
  computeUnitIx,
  createUserAndFund,
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '../utils/testTransactions'
import { ProgramAccount } from '@coral-xyz/anchor'
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SYSVAR_STAKE_HISTORY_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
  StakeProgram,
  SystemProgram,
} from '@solana/web3.js'
import {
  createBondsFundedStakeAccount,
  createVoteAccount,
} from '../utils/staking'
import { signer, pubkey } from '@marinade.finance/web3js-common'
import {
  MERKLE_ROOT_BUF,
  configAccountKeypair,
  totalClaimVoteAccount1,
  totalClaimVoteAccount2,
  treeNodeBy,
  voteAccount1Keypair,
  voteAccount2Keypair,
  withdrawer1,
  withdrawer1Keypair,
  withdrawer2,
  withdrawer2Keypair,
  withdrawer3,
  withdrawer3Keypair,
} from '../utils/merkleTreeTestData'
import { checkErrorMessage, verifyError } from '@marinade.finance/anchor-common'
import BN from 'bn.js'

describe('Validator Bonds claim settlement', () => {
  const epochsToClaimSettlement = 3
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let config: ProgramAccount<Config>
  let bondAccount: PublicKey
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
    const { configAccount, operatorAuthority: operatorAuth } =
      await executeInitConfigInstruction({
        program,
        provider,
        epochsToClaimSettlement,
        configAccountKeypair: configAccountKeypair,
      })
    operatorAuthority = operatorAuth
    config = {
      publicKey: configAccount,
      account: await getConfig(program, configAccount),
    }
    ;({ voteAccount: voteAccount1, validatorIdentity: validatorIdentity1 } =
      await createVoteAccount({
        voteAccount: voteAccount1Keypair,
        provider,
      }))
    await executeInitBondInstruction({
      program,
      provider,
      config: config.publicKey,
      voteAccount: voteAccount1,
      validatorIdentity: validatorIdentity1,
    })
    ;({ voteAccount: voteAccount2, validatorIdentity: validatorIdentity2 } =
      await createVoteAccount({
        voteAccount: voteAccount2Keypair,
        provider,
      }))
    ;({ bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      config: config.publicKey,
      voteAccount: voteAccount2,
      validatorIdentity: validatorIdentity2,
    }))

    rentCollector = Keypair.generate()
    settlementEpoch = await currentEpoch(provider)
    ;({ settlementAccount: settlementAccount1 } = await executeInitSettlement({
      config: config.publicKey,
      program,
      provider,
      voteAccount: voteAccount1,
      operatorAuthority,
      currentEpoch: settlementEpoch,
      rentCollector: rentCollector.publicKey,
      merkleRoot: MERKLE_ROOT_BUF,
      maxMerkleNodes: 1,
      maxTotalClaim: totalClaimVoteAccount1,
    }))
    ;({ settlementAccount: settlementAccount2 } = await executeInitSettlement({
      config: config.publicKey,
      program,
      provider,
      voteAccount: voteAccount2,
      operatorAuthority,
      currentEpoch: settlementEpoch,
      merkleRoot: MERKLE_ROOT_BUF,
      // wrongly setup to be able to get errors from contract
      maxMerkleNodes: 1,
      maxTotalClaim: 100, // has to be lower than 111111
    }))
    stakeAccount1 = await createBondsFundedStakeAccount({
      program,
      provider,
      config: config.publicKey,
      voteAccount: voteAccount1,
      lamports: totalClaimVoteAccount1.toNumber() + LAMPORTS_PER_SOL * 5,
    })
    stakeAccount2 = await createBondsFundedStakeAccount({
      program,
      provider,
      config: config.publicKey,
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
    if ((await provider.context.banksClient.getAccount(withdrawer1)) === null) {
      await createUserAndFund(provider, LAMPORTS_PER_SOL, withdrawer1Keypair)
      await createUserAndFund(provider, LAMPORTS_PER_SOL, withdrawer2Keypair)
      await createUserAndFund(provider, LAMPORTS_PER_SOL, withdrawer3Keypair)
    }
  })

  it('claim settlement various', async () => {
    const treeNode1Withdrawer1 = treeNodeBy(voteAccount1, withdrawer1)
    const { instruction: ixWrongTreeNode } = await claimSettlementInstruction({
      program,
      claimAmount: treeNode1Withdrawer1.treeNode.data.claim.subn(1),
      merkleProof: treeNode1Withdrawer1.proof,
      withdrawer: withdrawer1,
      settlementAccount: settlementAccount1,
      stakeAccount: stakeAccount1,
    })
    try {
      await provider.sendIx([], computeUnitIx, ixWrongTreeNode)
      throw new Error('should have failed; wrong tree node proof')
    } catch (e) {
      verifyError(e, Errors, 6029, 'claim proof failed')
    }

    const rentPayer = await createUserAndFund(provider, LAMPORTS_PER_SOL)
    const { instruction, settlementClaimAccount } =
      await claimSettlementInstruction({
        program,
        claimAmount: treeNode1Withdrawer1.treeNode.data.claim,
        merkleProof: treeNode1Withdrawer1.proof,
        withdrawer: withdrawer1,
        settlementAccount: settlementAccount1,
        stakeAccount: stakeAccount1,
        rentPayer: rentPayer,
      })
    try {
      await provider.sendIx([signer(rentPayer)], computeUnitIx, instruction)
      throw new Error('should have failed; stake is not deactivated')
    } catch (e) {
      expect(checkErrorMessage(e, 'insufficient funds')).toBeTruthy()
    }

    warpToNextEpoch(provider) // deactivate stake account

    await provider.sendIx([signer(rentPayer)], computeUnitIx, instruction)

    const [bondsWithdrawerAuthority] = withdrawerAuthority(
      configAccountKeypair.publicKey,
      program.programId
    )
    const [settlementClaimAddr, bump] = settlementClaimAddress(
      {
        settlement: settlementAccount1,
        stakeAuthority: bondsWithdrawerAuthority,
        voteAccount: voteAccount1,
        withdrawAuthority: withdrawer1,
        claim: treeNode1Withdrawer1.treeNode.data.claim,
      },
      program.programId
    )
    expect(settlementClaimAccount).toEqual(settlementClaimAddr)
    const settlementClaim = await getSettlementClaim(
      program,
      settlementClaimAccount
    )
    expect(settlementClaim.amount).toEqual(
      treeNode1Withdrawer1.treeNode.data.claim
    )
    expect(settlementClaim.bump).toEqual(bump)
    expect(settlementClaim.rentCollector).toEqual(pubkey(rentPayer))
    expect(settlementClaim.settlement).toEqual(pubkey(settlementAccount1))
    expect(settlementClaim.stakeAuthority).toEqual(bondsWithdrawerAuthority)
    expect(settlementClaim.voteAccount).toEqual(pubkey(voteAccount1))
    expect(settlementClaim.withdrawAuthority).toEqual(withdrawer1)
    const settlementClaimAccountInfo = await provider.connection.getAccountInfo(
      settlementClaimAccount
    )
    expect(
      (await provider.connection.getAccountInfo(pubkey(rentPayer)))?.lamports
    ).toEqual(LAMPORTS_PER_SOL - settlementClaimAccountInfo!.lamports)

    await warpToNextEpoch(provider)

    try {
      await provider.sendIx([signer(rentPayer)], computeUnitIx, instruction)
      throw new Error('should have failed; already claimed')
    } catch (e) {
      expect((e as Error).message).toMatch('custom program error: 0x0')
    }

    try {
      const wrongBumpIx = await claimSettlementWrongBump({
        proof: treeNode1Withdrawer1.proof,
        claim: treeNode1Withdrawer1.treeNode.data.claim,
        withdrawer: withdrawer1,
        configAccount: config.publicKey,
        bondAccount: bondAccount,
        settlementAccount: settlementAccount1,
        stakeAccount: stakeAccount1,
        voteAccount: voteAccount1,
      })
      await provider.sendIx([signer(rentPayer)], wrongBumpIx, instruction)
      throw new Error('should have failed; already claimed')
    } catch (e) {
      expect((e as Error).message).toMatch('custom program error: 0x7d6')
    }

    const treeNode1Withdrawer2 = treeNodeBy(voteAccount1, withdrawer2)
    const { instruction: ixWrongMerkleTreeNodes } =
      await claimSettlementInstruction({
        program,
        claimAmount: treeNode1Withdrawer2.treeNode.data.claim,
        merkleProof: treeNode1Withdrawer2.proof,
        withdrawer: withdrawer2,
        settlementAccount: settlementAccount1,
        stakeAccount: stakeAccount1,
      })
    try {
      await provider.sendIx([], computeUnitIx, ixWrongMerkleTreeNodes)
      throw new Error('should have failed; wrong stake account')
    } catch (e) {
      verifyError(e, Errors, 6033, 'exceeded number of claimable nodes')
    }

    const treeNode2Withdrawer2 = treeNodeBy(voteAccount2, withdrawer2)
    const { instruction: treeNode2Withdrawer2Ix } =
      await claimSettlementInstruction({
        program,
        claimAmount: treeNode2Withdrawer2.treeNode.data.claim,
        merkleProof: treeNode2Withdrawer2.proof,
        withdrawer: withdrawer2,
        settlementAccount: settlementAccount2,
        stakeAccount: stakeAccount2,
      })
    try {
      await provider.sendIx([], computeUnitIx, treeNode2Withdrawer2Ix)
      throw new Error(
        'should have failed; over claimed (wrong argument on settlement)'
      )
    } catch (e) {
      verifyError(e, Errors, 6032, 'the max total claim')
    }

    const treeNode2Withdrawer1 = treeNodeBy(voteAccount2, withdrawer1)
    const { instruction: ixWrongStakeAccount } =
      await claimSettlementInstruction({
        program,
        claimAmount: treeNode2Withdrawer1.treeNode.data.claim,
        merkleProof: treeNode2Withdrawer1.proof,
        withdrawer: withdrawer1,
        settlementAccount: settlementAccount2,
        stakeAccount: stakeAccount1,
      })
    try {
      await provider.sendIx([], computeUnitIx, ixWrongStakeAccount)
      throw new Error('should have failed; wrong stake account')
    } catch (e) {
      verifyError(e, Errors, 6036, 'not funded under the settlement')
    }

    const { instruction: treeNode2Withdrawer1Ix } =
      await claimSettlementInstruction({
        program,
        claimAmount: treeNode2Withdrawer1.treeNode.data.claim,
        merkleProof: treeNode2Withdrawer1.proof,
        withdrawer: withdrawer1,
        settlementAccount: settlementAccount2,
        stakeAccount: stakeAccount2,
      })
    await provider.sendIx([], computeUnitIx, treeNode2Withdrawer1Ix)

    await warpToNotBeClaimable()

    const treeNode1Withdrawer3 = treeNodeBy(voteAccount1, withdrawer3)
    const { instruction: ixTooLate, settlementClaimAccount: accTooLate } =
      await claimSettlementInstruction({
        program,
        claimAmount: treeNode1Withdrawer3.treeNode.data.claim,
        merkleProof: treeNode1Withdrawer3.proof,
        withdrawer: withdrawer3,
        settlementAccount: settlementAccount1,
        stakeAccount: stakeAccount1,
      })
    try {
      await provider.sendIx([], computeUnitIx, ixTooLate)
      throw new Error('should have failed; too late to claim')
    } catch (e) {
      verifyError(e, Errors, 6023, 'already expired')
    }
    assertNotExist(provider, accTooLate)
  })

  async function warpToNotBeClaimable() {
    await warpOffsetEpoch(provider, epochsToClaimSettlement + 1)
  }

  async function claimSettlementWrongBump({
    proof,
    claim,
    withdrawer,
    configAccount,
    bondAccount,
    settlementAccount,
    stakeAccount,
    voteAccount,
  }: {
    proof: number[][]
    claim: BN | number
    withdrawer: PublicKey
    configAccount: PublicKey
    bondAccount: PublicKey
    settlementAccount: PublicKey
    stakeAccount: PublicKey
    voteAccount: PublicKey
  }) {
    const [bondsWithdrawerAuthority] = withdrawerAuthority(
      configAccount,
      program.programId
    )
    let [, bump] = settlementClaimAddress(
      {
        settlement: settlementAccount,
        stakeAuthority: bondsWithdrawerAuthority,
        voteAccount,
        withdrawAuthority: withdrawer,
        claim,
      },
      program.programId
    )
    let settlementAccountWrongBump: PublicKey | undefined
    const seeds = [
      SETTLEMENT_CLAIM_SEED,
      settlementAccount.toBytes(),
      MerkleTreeNode.hash({
        stakeAuthority: bondsWithdrawerAuthority,
        withdrawAuthority: withdrawer,
        voteAccount: voteAccount,
        claim: claim,
      }).buffer,
    ]
    while (settlementAccountWrongBump === undefined && bump > 0) {
      bump--
      const seedsWithBump = seeds.concat(Buffer.from([bump]))
      try {
        settlementAccountWrongBump = PublicKey.createProgramAddressSync(
          seedsWithBump,
          program.programId
        )
      } catch (e) {
        if (e instanceof TypeError) {
          throw e
        }
      }
    }
    // console.log('correct claim settlement', correct, 'wrong bump', settlementAccountWrongBump?.toBase58(), 'with bump', bump)
    return await program.methods
      .claimSettlement({
        proof,
        claim: new BN(claim),
      })
      .accounts({
        withdrawAuthority: withdrawer,
        config: configAccount,
        bond: bondAccount,
        settlement: settlementAccount,
        settlementClaim: settlementAccountWrongBump,
        stakeAccount,
        rentPayer: provider.walletPubkey,
        systemProgram: SystemProgram.programId,
        stakeHistory: SYSVAR_STAKE_HISTORY_PUBKEY,
        clock: SYSVAR_CLOCK_PUBKEY,
        stakeProgram: StakeProgram.programId,
      })
      .instruction()
  }
})
