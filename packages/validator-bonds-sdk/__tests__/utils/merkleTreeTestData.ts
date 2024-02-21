import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes'
import { MerkleTreeNode } from '../../src'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import BN from 'bn.js'
import { ExtendedProvider } from './provider'
import { createUserAndFund } from './testTransactions'

export const MERKLE_PROOF_VOTE_ACCOUNT_1 =
  'EnBJg4qV4GjH3Sgigsi8wkWz966QYgSQkgPMCmWto51f'
export const MERKLE_ROOT_VOTE_ACCOUNT_1_BUF = bs58.decode(
  MERKLE_PROOF_VOTE_ACCOUNT_1
)
export const MERKLE_PROOF_VOTE_ACCOUNT_2 =
  'Asi9uVpB3Tx29L17X3Z46jrPizKywTRttqsvnLTzgh27'
export const MERKLE_ROOT_VOTE_ACCOUNT_2_BUF = bs58.decode(
  MERKLE_PROOF_VOTE_ACCOUNT_2
)
export const MERKLE_PROOF_OPERATOR =
  'D8rFThGJXYVFcKdqovz3VMA1nALNugHzvGYhSn8dLwip'
export const MERKLE_ROOT_VOTE_OPERATOR_BUF = bs58.decode(MERKLE_PROOF_OPERATOR)

export const configAccount = new PublicKey(
  '4wQELTA1RMEM3cKN7gjbiNN247e3GY9Sga7MKpNV38kL'
)
export const configAccountKeypair = Keypair.fromSecretKey(
  new Uint8Array([
    195, 59, 42, 183, 63, 138, 218, 169, 10, 100, 131, 107, 2, 115, 249, 203,
    208, 118, 243, 242, 24, 147, 123, 88, 139, 227, 106, 207, 94, 218, 99, 100,
    58, 130, 176, 204, 178, 57, 15, 228, 92, 42, 250, 174, 237, 156, 164, 110,
    140, 9, 134, 240, 11, 218, 244, 246, 119, 158, 226, 206, 102, 189, 44, 189,
  ])
)

export const voteAccount1 = new PublicKey(
  'FHUuZcuLB3ZLWZhKoY7metTEJ2Y2Xton99TTuDmzFmgW'
)
export const voteAccount1Keypair = Keypair.fromSecretKey(
  new Uint8Array([
    237, 246, 189, 191, 50, 152, 232, 64, 134, 120, 210, 214, 194, 111, 53, 133,
    170, 199, 146, 119, 157, 49, 109, 243, 195, 101, 77, 247, 84, 24, 140, 91,
    212, 60, 118, 175, 30, 52, 179, 95, 71, 227, 218, 208, 181, 105, 0, 118,
    215, 81, 90, 129, 131, 7, 0, 112, 16, 195, 54, 165, 197, 132, 148, 99,
  ])
)
export const voteAccount2 = new PublicKey(
  '9D6EuvndvhgDBLRzpxNjHdvLWicJE1WvZrdTbapjhKR6'
)
export const voteAccount2Keypair = Keypair.fromSecretKey(
  new Uint8Array([
    158, 19, 28, 228, 253, 204, 120, 137, 23, 230, 13, 29, 237, 102, 35, 165,
    229, 88, 46, 52, 155, 70, 76, 191, 107, 215, 89, 254, 81, 194, 210, 246,
    121, 246, 99, 205, 241, 99, 163, 208, 21, 194, 189, 10, 12, 150, 243, 133,
    109, 226, 97, 167, 38, 231, 184, 41, 76, 143, 181, 153, 145, 234, 174, 125,
  ])
)

export const withdrawer1 = new PublicKey(
  '3vGstFWWyQbDknu9WKr9vbTn2Kw5qgorP7UkRXVrfe9t'
)
export const withdrawer1Keypair = Keypair.fromSecretKey(
  new Uint8Array([
    24, 43, 11, 179, 150, 224, 217, 74, 162, 155, 151, 213, 201, 83, 185, 19,
    246, 232, 231, 211, 169, 98, 182, 164, 121, 32, 13, 149, 173, 20, 162, 79,
    43, 93, 27, 248, 91, 110, 139, 170, 254, 199, 133, 92, 39, 0, 152, 214, 250,
    62, 25, 69, 251, 157, 144, 190, 219, 23, 97, 15, 224, 80, 64, 55,
  ])
)
export const withdrawer2 = new PublicKey(
  'DBnWKq1Ln9y8HtGwYxFMqMWLY1Ld9xpB28ayKfHejiTs'
)
export const withdrawer2Keypair = Keypair.fromSecretKey(
  new Uint8Array([
    203, 169, 131, 90, 255, 189, 179, 151, 246, 221, 4, 202, 168, 89, 103, 56,
    157, 52, 187, 22, 120, 178, 211, 8, 225, 71, 217, 211, 169, 238, 96, 10,
    181, 15, 129, 42, 37, 41, 183, 202, 199, 50, 186, 123, 22, 52, 73, 23, 52,
    93, 14, 155, 96, 140, 165, 205, 167, 146, 16, 93, 55, 109, 137, 58,
  ])
)
export const withdrawer3 = new PublicKey(
  'CgoqXy3e1hsnuNw6bJ8iuzqZwr93CA4jsRa1AnsseJ53'
)
export const withdrawer3Keypair = Keypair.fromSecretKey(
  new Uint8Array([
    229, 228, 121, 248, 83, 69, 46, 5, 231, 40, 199, 127, 48, 139, 100, 228, 69,
    221, 133, 64, 199, 252, 158, 244, 226, 80, 66, 188, 168, 164, 93, 248, 173,
    163, 42, 144, 216, 187, 230, 250, 231, 216, 255, 149, 48, 250, 11, 4, 144,
    101, 205, 13, 212, 139, 234, 174, 137, 193, 203, 120, 62, 72, 48, 54,
  ])
)
export const staker1 = new PublicKey(
  '82ewSU2zNH87PajZHf7betFbZAaGR8bwDp8azSHNCAnA'
)
export const staker1Keypair = Keypair.fromSecretKey(
  new Uint8Array([
    218, 170, 197, 166, 53, 192, 63, 159, 39, 96, 27, 63, 60, 54, 20, 37, 175,
    133, 29, 137, 201, 158, 185, 75, 229, 195, 218, 84, 224, 18, 132, 90, 104,
    110, 73, 95, 79, 243, 182, 90, 217, 252, 233, 229, 107, 63, 197, 97, 76, 0,
    105, 145, 196, 120, 55, 249, 125, 102, 175, 0, 14, 54, 242, 71,
  ])
)
export const staker2 = new PublicKey(
  'yrWTX1AuJRqziVpdhg3eAWYhDcY6z1kmEaG4sn1uDDj'
)
export const staker2Keypair = Keypair.fromSecretKey(
  new Uint8Array([
    93, 46, 170, 206, 152, 187, 178, 113, 53, 239, 189, 73, 185, 144, 23, 247,
    152, 17, 11, 137, 123, 190, 100, 200, 171, 63, 129, 97, 104, 31, 242, 166,
    14, 144, 129, 9, 100, 247, 64, 23, 90, 4, 129, 164, 60, 147, 105, 30, 178,
    32, 53, 241, 69, 223, 221, 163, 160, 7, 206, 122, 243, 20, 34, 210,
  ])
)
export const staker3 = new PublicKey(
  '121WqnefAgXvLZdW42LsGUbkFjv7LVUqvcpkskxyVgeu'
)
export const staker3Keypair = Keypair.fromSecretKey(
  new Uint8Array([
    239, 228, 16, 105, 188, 164, 129, 247, 76, 155, 63, 239, 0, 232, 18, 213,
    66, 16, 48, 162, 0, 97, 208, 207, 253, 76, 61, 110, 116, 53, 132, 40, 0, 66,
    41, 157, 121, 136, 32, 33, 19, 3, 237, 196, 175, 7, 83, 87, 142, 142, 63,
    35, 239, 229, 200, 90, 175, 201, 48, 138, 37, 141, 5, 18,
  ])
)

export type MerkleTreeNodeWithProof = {
  treeNode: MerkleTreeNode
  proof: number[][]
}

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
        84, 75, 193, 1, 167, 55, 248, 48, 129, 33, 198, 240, 33, 229, 57, 27,
        194, 110, 52, 184, 244, 142, 198, 188, 161, 150, 177, 49, 26, 123, 214,
        187,
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
        84, 75, 193, 1, 167, 55, 248, 48, 129, 33, 198, 240, 33, 229, 57, 27,
        194, 110, 52, 184, 244, 142, 198, 188, 161, 150, 177, 49, 26, 123, 214,
        187,
      ],
    ],
  },
  {
    // tree node hash: 8dvRJGLNRPo1arYFQmyCQXCBELitRr9ofEMFc1sWJkT3
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer3,
      stakeAuthority: staker2,
      claim: 212121,
    }),
    proof: [
      [
        166, 246, 173, 43, 141, 45, 116, 63, 47, 72, 233, 142, 194, 147, 46, 95,
        230, 82, 47, 160, 178, 230, 171, 35, 23, 110, 28, 124, 156, 30, 183,
        213,
      ],
      [
        146, 196, 239, 63, 54, 200, 90, 234, 50, 1, 61, 217, 219, 111, 207, 131,
        119, 168, 107, 251, 218, 240, 133, 67, 116, 40, 11, 109, 116, 34, 154,
        73,
      ],
    ],
  },
]
export const ITEMS_VOTE_ACCOUNT_2: MerkleTreeNodeWithProof[] = [
  {
    // tree node hash: 2niLq4dRayu3GE5KWuBUR4hAjSikubd1hmGKLJ56ZzUP
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer1,
      stakeAuthority: staker2,
      claim: 69,
    }),
    proof: [
      [
        16, 219, 27, 0, 11, 79, 28, 196, 63, 139, 175, 99, 74, 209, 251, 106,
        140, 44, 154, 15, 12, 234, 135, 101, 17, 239, 22, 155, 21, 139, 212, 31,
      ],
    ],
  },
  {
    // tree node hash: 4WmpRvgW6HdHW4bPVEqPVJXyF2mVG9wpH5mGpgzjmJGY
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer2,
      stakeAuthority: staker3,
      claim: 111111,
    }),
    proof: [
      [
        245, 60, 45, 210, 173, 189, 121, 115, 156, 166, 90, 8, 24, 102, 217,
        217, 177, 135, 83, 7, 150, 22, 184, 83, 71, 126, 39, 173, 241, 24, 242,
        18,
      ],
    ],
  },
]
export const ITEMS_OPERATOR: MerkleTreeNodeWithProof[] = [
  {
    // tree node hash: C8ZfYuKidJa8EGF4YF5Xou3icvqqGQ6fJBE6SN3ixT1w
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer1,
      stakeAuthority: staker2,
      claim: 556677,
    }),
    proof: [
      [
        114, 203, 9, 47, 201, 96, 238, 219, 33, 102, 140, 80, 223, 86, 48, 16,
        64, 99, 249, 31, 149, 206, 129, 57, 137, 107, 46, 191, 2, 60, 178, 134,
      ],
    ],
  },
  {
    // tree node hash: AuSbVtXRJwt7ch9ESqMatVrLdJCXCcAFfX5aYSfD8Aq7
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer2,
      stakeAuthority: staker3,
      claim: 996677,
    }),
    proof: [
      [
        18, 245, 29, 35, 129, 16, 97, 65, 136, 147, 235, 130, 40, 114, 206, 62,
        14, 78, 151, 58, 189, 18, 192, 239, 240, 174, 45, 119, 149, 131, 85, 92,
      ],
    ],
  },
]

export const treeNodesVoteAccount1 = ITEMS_VOTE_ACCOUNT_1
export const totalClaimVoteAccount1 = treeNodesVoteAccount1.reduce(
  (acc, item) => acc.add(item.treeNode.data.claim),
  new BN(0)
)
export const treeNodesVoteAccount2 = ITEMS_VOTE_ACCOUNT_2
export const totalClaimVoteAccount2 = treeNodesVoteAccount2.reduce(
  (acc, item) => acc.add(item.treeNode.data.claim),
  new BN(0)
)

export function treeNodeBy(
  voteAccount: PublicKey,
  withdrawer: PublicKey
): MerkleTreeNodeWithProof {
  if (voteAccount.equals(voteAccount1)) {
    return treeNodeByWithdrawer(ITEMS_VOTE_ACCOUNT_1, withdrawer)
  } else if (voteAccount.equals(voteAccount2)) {
    return treeNodeByWithdrawer(ITEMS_VOTE_ACCOUNT_2, withdrawer)
  } else {
    throw new Error(
      `tree node for vote account ${voteAccount.toBase58()} not found`
    )
  }
}

export function treeNodeByWithdrawer(
  treeNodeList: MerkleTreeNodeWithProof[],
  withdrawer: PublicKey
): MerkleTreeNodeWithProof {
  const treeNodesByWithdrawer = treeNodeList.find(item =>
    item.treeNode.data.withdrawAuthority.equals(withdrawer)
  )
  if (!treeNodesByWithdrawer) {
    throw new Error(
      `tree node for withdrawer ${withdrawer.toBase58()} not found`
    )
  }
  return treeNodesByWithdrawer
}

export async function createWithdrawerUsers(provider: ExtendedProvider) {
  let exists = false
  try {
    exists = (await provider.connection.getAccountInfo(withdrawer1)) !== null
  } catch (e) {
    exists = false
  }
  if (exists === false) {
    await createUserAndFund(provider, LAMPORTS_PER_SOL, withdrawer1Keypair)
    await createUserAndFund(provider, LAMPORTS_PER_SOL, withdrawer2Keypair)
    await createUserAndFund(provider, LAMPORTS_PER_SOL, withdrawer3Keypair)
  }
}
