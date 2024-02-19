import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  ClaimSettlementEvent,
  CLAIM_SETTLEMENT_EVENT,
  claimSettlementInstruction,
  fundSettlementInstruction,
  settlementClaimAddress,
  findSettlementClaims,
  CloseSettlementClaimEvent,
  CLOSE_SETTLEMENT_CLAIM_EVENT,
  closeSettlementInstruction,
  closeSettlementClaimInstruction,
} from '../../src'
import { getValidatorInfo, initTest, waitForNextEpoch } from './testValidator'
import {
  createUserAndFund,
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '../utils/testTransactions'
import { ExtendedProvider } from '../utils/provider'
import { signer } from '@marinade.finance/web3js-common'
import {
  MERKLE_ROOT_VOTE_ACCOUNT_1_BUF,
  configAccountKeypair,
  staker2,
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
  createStakeAccount,
  createVoteAccount,
} from '../utils/staking'

// NOTE: order of tests need to be maintained
describe('Validator Bonds claim settlement', () => {
  let provider: ExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let operatorAuthority: Keypair
  let validatorIdentity: Keypair
  let settlementAccount: PublicKey
  let stakeAccount: PublicKey
  let fundSettlementRentPayer: Keypair

  beforeAll(async () => {
    ;({ provider, program } = await initTest())
    ;({ validatorIdentity } = await getValidatorInfo(provider.connection))
    ;({ configAccount, operatorAuthority } = await executeInitConfigInstruction(
      {
        program,
        provider,
        configAccountKeypair: configAccountKeypair,
        epochsToClaimSettlement: 1,
      }
    ))
    await createVoteAccount({
      voteAccount: voteAccount1Keypair,
      provider,
      validatorIdentity,
    })
    await executeInitBondInstruction({
      config: configAccount,
      program,
      provider,
      voteAccount: voteAccount1,
      validatorIdentity,
    })
    ;({ settlementAccount } = await executeInitSettlement({
      config: configAccount,
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
      lamports: totalClaimVoteAccount1.toNumber() + LAMPORTS_PER_SOL * 555,
    })
    const { instruction: fundIx, splitStakeAccount } =
      await fundSettlementInstruction({
        program,
        settlementAccount,
        stakeAccount,
      })
    await provider.sendIx(
      [signer(splitStakeAccount), operatorAuthority],
      fundIx
    )
    // will be used for rent payer of claim settlement
    fundSettlementRentPayer = (await createUserAndFund(
      provider,
      LAMPORTS_PER_SOL
    )) as Keypair
  })

  afterAll(async () => {
    // workaround: "Jest has detected the following 1 open handle", see `initConfig.spec.ts`
    await new Promise(resolve => setTimeout(resolve, 500))
  })

  it('claim settlement', async () => {
    const event = new Promise<ClaimSettlementEvent>(resolve => {
      const listener = program.addEventListener(
        CLAIM_SETTLEMENT_EVENT,
        async event => {
          await program.removeEventListener(listener)
          resolve(event)
        }
      )
    })

    await createUserAndFund(provider, LAMPORTS_PER_SOL, withdrawer1Keypair)
    const treeNodeVoteAccount1Withdrawer1 = treeNodeBy(
      voteAccount1,
      withdrawer1
    )
    const stakeAccountTreeNodeVoteAccount1Withdrawer1 =
      await createStakeAccount({
        provider,
        lamports: 4 * LAMPORTS_PER_SOL,
        voteAccount: voteAccount1,
        newStakerAuthority:
          treeNodeVoteAccount1Withdrawer1.treeNode.stakeAuthority,
        newWithdrawerAuthority:
          treeNodeVoteAccount1Withdrawer1.treeNode.withdrawAuthority,
      })

    const { instruction, settlementClaimAccount } =
      await claimSettlementInstruction({
        program,
        claimAmount: treeNodeVoteAccount1Withdrawer1.treeNode.data.claim,
        merkleProof: treeNodeVoteAccount1Withdrawer1.proof,
        settlementAccount,
        stakeAccountFrom: stakeAccount,
        stakeAccountTo: stakeAccountTreeNodeVoteAccount1Withdrawer1,
        rentPayer: fundSettlementRentPayer.publicKey,
      })
    await provider.sendIx([fundSettlementRentPayer], instruction)

    const [settlementClaimAddr, bumpSettlementClaim] = settlementClaimAddress(
      {
        settlement: settlementAccount,
        stakeAccountStaker:
          treeNodeVoteAccount1Withdrawer1.treeNode.stakeAuthority,
        stakeAccountWithdrawer:
          treeNodeVoteAccount1Withdrawer1.treeNode.withdrawAuthority,
        claim: treeNodeVoteAccount1Withdrawer1.treeNode.data.claim,
      },
      program.programId
    )
    expect(settlementClaimAccount).toEqual(settlementClaimAddr)

    await event.then(e => {
      expect(e.settlement).toEqual(settlementAccount)
      expect(e.amount).toEqual(
        treeNodeVoteAccount1Withdrawer1.treeNode.data.claim
      )
      expect(e.bump).toEqual(bumpSettlementClaim)
      expect(e.rentCollector).toEqual(fundSettlementRentPayer.publicKey)
      expect(e.settlement).toEqual(settlementAccount)
      expect(e.settlementClaim).toEqual(settlementClaimAccount)
      expect(e.settlementLamportsClaimed).toEqual(
        treeNodeVoteAccount1Withdrawer1.treeNode.data.claim
      )
      expect(e.settlementMerkleNodesClaimed).toEqual(1)
      expect(e.stakeAccountStaker).toEqual(
        treeNodeVoteAccount1Withdrawer1.treeNode.stakeAuthority
      )
      expect(e.stakeAccountWithdrawer).toEqual(
        treeNodeVoteAccount1Withdrawer1.treeNode.withdrawAuthority
      )
      expect(e.stakeAccountTo).toEqual(
        stakeAccountTreeNodeVoteAccount1Withdrawer1
      )
    })
  })

  it('find claim settlements', async () => {
    await createUserAndFund(provider, LAMPORTS_PER_SOL, withdrawer2Keypair)
    const treeNodeWithdrawer2 = treeNodeBy(voteAccount1, withdrawer2)
    const stakeAccountTreeNodeWithdrawer2 = await createStakeAccount({
      provider,
      lamports: 6 * LAMPORTS_PER_SOL,
      voteAccount: voteAccount1,
      newStakerAuthority: treeNodeWithdrawer2.treeNode.stakeAuthority,
      newWithdrawerAuthority: treeNodeWithdrawer2.treeNode.withdrawAuthority,
    })
    const { instruction: ix1 } = await claimSettlementInstruction({
      program,
      claimAmount: treeNodeWithdrawer2.treeNode.data.claim,
      merkleProof: treeNodeWithdrawer2.proof,
      settlementAccount,
      stakeAccountFrom: stakeAccount,
      stakeAccountTo: stakeAccountTreeNodeWithdrawer2,
    })
    await createUserAndFund(provider, LAMPORTS_PER_SOL, withdrawer3Keypair)
    const treeNodeWithdrawer3 = treeNodeBy(voteAccount1, withdrawer3)
    const stakeAccountTreeNodeWithdrawer3 = await createStakeAccount({
      provider,
      lamports: 7 * LAMPORTS_PER_SOL,
      voteAccount: voteAccount1,
      newStakerAuthority: treeNodeWithdrawer3.treeNode.stakeAuthority,
      newWithdrawerAuthority: treeNodeWithdrawer3.treeNode.withdrawAuthority,
    })
    const { instruction: ix2 } = await claimSettlementInstruction({
      program,
      claimAmount: treeNodeWithdrawer3.treeNode.data.claim,
      merkleProof: treeNodeWithdrawer3.proof,
      settlementAccount,
      stakeAccountFrom: stakeAccount,
      stakeAccountTo: stakeAccountTreeNodeWithdrawer3,
    })

    await provider.sendIx([], ix1, ix2)

    let findSettlementList = await findSettlementClaims({
      program,
      settlement: settlementAccount,
    })
    expect(findSettlementList.length).toBeGreaterThanOrEqual(2)

    findSettlementList = await findSettlementClaims({
      program,
      stakeAccountStaker: staker2,
    })
    expect(findSettlementList.length).toBeGreaterThanOrEqual(1)
    findSettlementList = await findSettlementClaims({
      program,
      stakeAccountWithdrawer: withdrawer1,
    })
    expect(findSettlementList.length).toEqual(1)
    findSettlementList = await findSettlementClaims({
      program,
      settlement: settlementAccount,
      stakeAccountStaker: staker2,
    })
    expect(findSettlementList.length).toBeGreaterThanOrEqual(1)
  })

  it('close settlement claim', async () => {
    const event = new Promise<CloseSettlementClaimEvent>(resolve => {
      const listener = program.addEventListener(
        CLOSE_SETTLEMENT_CLAIM_EVENT,
        async event => {
          await program.removeEventListener(listener)
          resolve(event)
        }
      )
    })

    expect(
      (
        await provider.connection.getAccountInfo(
          fundSettlementRentPayer.publicKey
        )
      )?.lamports
    ).toBeLessThan(LAMPORTS_PER_SOL)

    const treeNodeVoteAccount1Withdrawer1 = treeNodeBy(
      voteAccount1,
      withdrawer1
    )
    const [settlementClaimAccount] = settlementClaimAddress(
      {
        settlement: settlementAccount,
        stakeAccountStaker:
          treeNodeVoteAccount1Withdrawer1.treeNode.stakeAuthority,
        stakeAccountWithdrawer:
          treeNodeVoteAccount1Withdrawer1.treeNode.withdrawAuthority,
        claim: treeNodeVoteAccount1Withdrawer1.treeNode.data.claim,
      },
      program.programId
    )
    const { instruction: closeSettle1 } = await closeSettlementInstruction({
      program,
      settlementAccount,
      splitRentRefundAccount: stakeAccount,
    })
    const { instruction: closeIx } = await closeSettlementClaimInstruction({
      program,
      settlementAccount: settlementAccount,
      settlementClaimAccount,
      rentCollector: fundSettlementRentPayer.publicKey,
    })
    await waitForNextEpoch(provider.connection, 15)
    await waitForNextEpoch(provider.connection, 15)
    await provider.sendIx([], closeSettle1, closeIx)

    expect(
      provider.connection.getAccountInfo(settlementClaimAccount)
    ).resolves.toBeNull()
    expect(
      provider.connection.getAccountInfo(settlementAccount)
    ).resolves.toBeNull()
    expect(
      (
        await provider.connection.getAccountInfo(
          fundSettlementRentPayer.publicKey
        )
      )?.lamports
    ).toEqual(LAMPORTS_PER_SOL)

    await event.then(e => {
      expect(e.settlement).toEqual(settlementAccount)
      expect(e.rentCollector).toEqual(fundSettlementRentPayer.publicKey)
    })
  })
})
