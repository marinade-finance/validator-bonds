import {
  ValidatorBondsProgram,
  getSettlement,
  claimSettlementV1Instruction,
  closeSettlementV1Instruction,
  closeSettlementClaimV1Instruction,
  getSettlementClaim,
} from '../../../src'
import {
  BankrunExtendedProvider,
  assertNotExist,
  warpToEpoch,
} from '@marinade.finance/bankrun-utils'
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { createDelegatedStakeAccount } from '../../utils/staking'
import { initBankrunTest } from './../bankrun'
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes'
import BN from 'bn.js'

describe('Validator Bonds: claiming and closing V1 version accounts', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  const epochsToClaimSettlement = 10
  const settlementEpoch = 42_000_000
  // Saving here data that was loaded on-chain from file system
  // where accounts were created from contract in version v1.5.0
  // const configAccount = new PublicKey(
  //   '4wQELTA1RMEM3cKN7gjbiNN247e3GY9Sga7MKpNV38kL'
  // )
  // const operatorAuthority = Keypair.fromSecretKey(
  //   new Uint8Array([
  //     246, 126, 98, 108, 32, 66, 227, 42, 213, 42, 213, 254, 151, 163, 76, 87,
  //     192, 197, 209, 112, 209, 32, 185, 249, 76, 233, 174, 60, 189, 45, 235,
  //     149, 243, 0, 193, 228, 53, 103, 243, 178, 205, 153, 76, 188, 250, 43, 114,
  //     22, 190, 158, 212, 156, 133, 236, 25, 36, 136, 220, 4, 233, 8, 58, 174,
  //     63,
  //   ])
  // )
  // const validatorIdentity = Keypair.fromSecretKey(
  //   new Uint8Array([
  //     101, 137, 162, 156, 21, 194, 66, 217, 146, 179, 251, 28, 29, 150, 2, 242,
  //     103, 245, 127, 16, 102, 6, 209, 86, 128, 2, 143, 81, 157, 77, 120, 221,
  //     220, 238, 155, 186, 112, 223, 116, 242, 254, 230, 37, 127, 11, 6, 202, 67,
  //     107, 119, 169, 113, 46, 155, 241, 110, 18, 140, 77, 218, 148, 150, 40,
  //     123,
  //   ])
  // )
  const voteAccount1 = new PublicKey(
    'FHUuZcuLB3ZLWZhKoY7metTEJ2Y2Xton99TTuDmzFmgW'
  )
  const bondAccount = new PublicKey(
    'C64BjL47V5r26xnw8yYwfVRgu7mhkkMabBQPT8CeCzsh'
  )
  const settlementAccount = new PublicKey(
    'BgE7ME4DrJC5okjHtcoZuuMYLMsHMfip1nJVS5NNvPQf'
  )
  const stakeAccountFrom = new PublicKey(
    '7M9TkgxM8DHWgZnJNJif4Jyfyqb5NJuCgzvfgc9xjRE1'
  )
  let settlementClaim2Account: PublicKey | undefined = undefined

  // 6WMubUXAaYgQGSKFC31H4NRkriwaP7VJqukTAyMhytzZ
  // BBUdhr6vsEoFsQn6csMCpaiFo5rYXeDv1E7jZidLYfEx

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest(undefined, [
      './fixtures/accounts-v1/',
    ]))
    const settlementData = await getSettlement(program, settlementAccount)
    expect(bondAccount).toEqual(settlementData.bond)
  })

  it('claim settlement', async () => {
    expect(ITEMS_VOTE_ACCOUNT_1.length).toBeGreaterThan(1) // expecting length of 2
    const toClaim = ITEMS_VOTE_ACCOUNT_1[1]
    const stakeAmountBefore = 2 * LAMPORTS_PER_SOL
    const stakeAccountTo = await createDelegatedStakeAccount({
      provider,
      lamports: 2 * LAMPORTS_PER_SOL,
      voteAccount: voteAccount1,
      staker: toClaim.treeNode.data.stakeAuthority,
      withdrawer: toClaim.treeNode.data.withdrawAuthority,
    })

    warpToEpoch(provider, settlementEpoch + 1)

    const { instruction: ixClaim, settlementClaimAccount } =
      await claimSettlementV1Instruction({
        program,
        claimAmount: toClaim.treeNode.data.claim,
        merkleProof: toClaim.proof,
        settlementAccount: settlementAccount,
        stakeAccountFrom,
        stakeAccountTo,
        stakeAccountStaker: toClaim.treeNode.data.stakeAuthority,
        stakeAccountWithdrawer: toClaim.treeNode.data.withdrawAuthority,
      })
    await provider.sendIx([], ixClaim)
    settlementClaim2Account = settlementClaimAccount

    const settlementClaimV1 = await getSettlementClaim(
      program,
      settlementClaimAccount
    )
    expect(settlementClaimV1.settlement).toEqual(settlementAccount)
    expect(settlementClaimV1.amount).toEqual(toClaim.treeNode.data.claim)
    expect(settlementClaimV1.stakeAccountTo).toEqual(stakeAccountTo)
    const stakeAccountToInfo =
      await provider.connection.getAccountInfo(stakeAccountTo)
    expect(stakeAccountToInfo?.lamports).toEqual(
      stakeAmountBefore + toClaim.treeNode.data.claim.toNumber()
    )

    const toNotClaim = ITEMS_VOTE_ACCOUNT_1[0]
    const stakeAccountToNotClaim = await createDelegatedStakeAccount({
      provider,
      lamports: 2 * LAMPORTS_PER_SOL,
      voteAccount: voteAccount1,
      staker: toNotClaim.treeNode.data.stakeAuthority,
      withdrawer: toNotClaim.treeNode.data.withdrawAuthority,
    })
    const { instruction: ixClaimAlreadyClaimed } =
      await claimSettlementV1Instruction({
        program,
        claimAmount: toNotClaim.treeNode.data.claim,
        merkleProof: toNotClaim.proof,
        settlementAccount: settlementAccount,
        stakeAccountFrom,
        stakeAccountTo: stakeAccountToNotClaim,
        stakeAccountStaker: toNotClaim.treeNode.data.stakeAuthority,
        stakeAccountWithdrawer: toNotClaim.treeNode.data.withdrawAuthority,
      })
    try {
      await provider.sendIx([], ixClaimAlreadyClaimed)
      throw new Error('should have failed; already claimed')
    } catch (e) {
      // 0x0: Allocate: account Address ... already in use
      expect((e as Error).message).toContain('0x0')
    }
  })

  it('close settlement', async () => {
    const { instruction: closeSettlementIx } =
      await closeSettlementV1Instruction({
        program,
        settlementAccount,
        splitRentRefundAccount: stakeAccountFrom,
      })
    warpToEpoch(provider, settlementEpoch + epochsToClaimSettlement + 1)
    await provider.sendIx([], closeSettlementIx)
    assertNotExist(provider, settlementAccount)

    // loaded from file system
    const settlementClaim1Account = new PublicKey(
      '6WMubUXAaYgQGSKFC31H4NRkriwaP7VJqukTAyMhytzZ'
    )
    const { instruction: closeClaim1Ix } =
      await closeSettlementClaimV1Instruction({
        program,
        settlementAccount: settlementAccount,
        settlementClaimAccount: settlementClaim1Account,
      })
    await provider.sendIx([], closeClaim1Ix)
    assertNotExist(provider, settlementClaim1Account)

    if (settlementClaim2Account) {
      const { instruction: closeClaim2Ix } =
        await closeSettlementClaimV1Instruction({
          program,
          settlementAccount: settlementAccount,
          settlementClaimAccount: settlementClaim2Account,
        })
      await provider.sendIx([], closeClaim2Ix)
      assertNotExist(provider, settlementClaim2Account)
    }
  })
})

// ------------ TREE NODES V1 ------------
// In version V1 the merkle trees do not contain `index` as part of the hash

type MerkleTreeNodeDataInput = {
  stakeAuthority: PublicKey
  withdrawAuthority: PublicKey
  claim: BN | number
}

export type MerkleTreeNodeData = MerkleTreeNodeDataInput &
  Omit<MerkleTreeNodeDataInput, 'claim'> & { claim: BN }

// see settlement_engine/src/merkle_tree_collection.rs
export class MerkleTreeNode {
  public data: MerkleTreeNodeData
  constructor(data: MerkleTreeNodeDataInput) {
    this.data = {
      ...data,
      claim: new BN(data.claim),
    }
  }
}

export type MerkleTreeNodeWithProof = {
  treeNode: MerkleTreeNode
  proof: number[][]
}

export const staker1 = new PublicKey(
  '82ewSU2zNH87PajZHf7betFbZAaGR8bwDp8azSHNCAnA'
)
export const withdrawer1 = new PublicKey(
  '3vGstFWWyQbDknu9WKr9vbTn2Kw5qgorP7UkRXVrfe9t'
)
export const withdrawer2 = new PublicKey(
  'DBnWKq1Ln9y8HtGwYxFMqMWLY1Ld9xpB28ayKfHejiTs'
)

export const MERKLE_PROOF_VOTE_ACCOUNT_1 =
  '6H5xisVj8r1aYRX2B2PyeG62ofF9aUiy8qHzwwkJCqqH'
export const MERKLE_ROOT_VOTE_ACCOUNT_1_BUF = bs58.decode(
  MERKLE_PROOF_VOTE_ACCOUNT_1
)
export const ITEMS_VOTE_ACCOUNT_1: MerkleTreeNodeWithProof[] = [
  {
    // tree node hash: 3tSbFBfFg83LCgVneuENUFs8hKgsdTKvfVV6Cqz3q6RT
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer1,
      stakeAuthority: staker1,
      claim: 1234,
    }),
    proof: [
      [
        71, 3, 238, 36, 44, 63, 252, 186, 190, 117, 55, 1, 74, 130, 163, 47, 15,
        108, 104, 68, 176, 233, 152, 64, 34, 167, 84, 90, 65, 102, 170, 109,
      ],
      [
        242, 32, 26, 226, 118, 158, 156, 230, 202, 164, 42, 249, 57, 87, 29, 89,
        247, 47, 67, 135, 233, 170, 92, 204, 187, 9, 203, 71, 176, 249, 129, 21,
      ],
      [
        100, 183, 165, 4, 15, 25, 171, 235, 171, 51, 238, 200, 78, 13, 144, 57,
        166, 114, 241, 15, 80, 249, 164, 234, 94, 171, 12, 64, 164, 69, 112, 50,
      ],
    ],
  },
  {
    // tree node hash: AQT4KsCwXci528hys9WgWcURigR4TiNKDsCV9iEmVZ1P
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer2,
      stakeAuthority: staker1,
      claim: 99999,
    }),
    proof: [
      [
        103, 169, 245, 71, 96, 235, 19, 74, 8, 98, 146, 214, 49, 193, 63, 248,
        55, 244, 31, 206, 177, 91, 206, 203, 184, 48, 99, 76, 163, 203, 232, 44,
      ],
      [
        242, 32, 26, 226, 118, 158, 156, 230, 202, 164, 42, 249, 57, 87, 29, 89,
        247, 47, 67, 135, 233, 170, 92, 204, 187, 9, 203, 71, 176, 249, 129, 21,
      ],
      [
        100, 183, 165, 4, 15, 25, 171, 235, 171, 51, 238, 200, 78, 13, 144, 57,
        166, 114, 241, 15, 80, 249, 164, 234, 94, 171, 12, 64, 164, 69, 112, 50,
      ],
    ],
  },
]
