import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes'
import { MerkleTreeNode, withdrawerAuthority } from '../../src'
import { Keypair, PublicKey } from '@solana/web3.js'
import BN from 'bn.js'

export const MERKLE_PROOF = 'CnJDz26xaCtWcmWroKK7R7A5TFUiQ5Nn2ZkZwfDkFUhX'
export const MERKLE_ROOT_BUF = bs58.decode(MERKLE_PROOF)

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
export const [stakeAuthority] = withdrawerAuthority(configAccount)

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

export const ITEMS: { treeNode: MerkleTreeNode; proof: number[][] }[] = [
  {
    // tree node hash: CUgEsyuML4P22hjkvmU6MRHi5jHvpPaB7UvD5t1V4uFc
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer1,
      stakeAuthority: stakeAuthority,
      voteAccount: voteAccount1,
      claim: 1234,
    }),
    proof: [
      [
        145, 243, 134, 236, 91, 34, 120, 28, 148, 88, 96, 37, 102, 91, 88, 198,
        139, 69, 1, 37, 142, 172, 108, 211, 239, 223, 147, 29, 235, 82, 213, 29,
      ],
      [
        51, 180, 11, 247, 245, 48, 222, 56, 183, 97, 207, 193, 65, 183, 32, 29,
        133, 119, 242, 240, 40, 85, 81, 66, 14, 200, 189, 144, 205, 161, 253,
        252,
      ],
      [
        182, 224, 192, 203, 65, 30, 57, 3, 19, 229, 229, 153, 47, 34, 38, 154,
        100, 242, 241, 250, 78, 156, 73, 53, 15, 171, 69, 55, 220, 64, 189, 237,
      ],
    ],
  },
  {
    // tree node hash: 3pwY1X2iV6vofeswACq53ywUE55Ux8BBY5EwxXApi3rA
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer2,
      stakeAuthority: stakeAuthority,
      voteAccount: voteAccount1,
      claim: 99999,
    }),
    proof: [
      [
        248, 164, 96, 200, 20, 222, 204, 58, 188, 135, 61, 238, 106, 53, 94, 59,
        123, 109, 112, 171, 22, 175, 141, 110, 240, 151, 160, 219, 28, 140, 24,
        1,
      ],
      [
        51, 180, 11, 247, 245, 48, 222, 56, 183, 97, 207, 193, 65, 183, 32, 29,
        133, 119, 242, 240, 40, 85, 81, 66, 14, 200, 189, 144, 205, 161, 253,
        252,
      ],
      [
        182, 224, 192, 203, 65, 30, 57, 3, 19, 229, 229, 153, 47, 34, 38, 154,
        100, 242, 241, 250, 78, 156, 73, 53, 15, 171, 69, 55, 220, 64, 189, 237,
      ],
    ],
  },
  {
    // tree node hash: EtS2pCv7w21NaRUdgd11ECSbrLrYezNgJqPbki6GC3hj
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer3,
      stakeAuthority: stakeAuthority,
      voteAccount: voteAccount1,
      claim: 212121,
    }),
    proof: [
      [
        155, 139, 240, 148, 18, 209, 48, 227, 246, 126, 88, 215, 186, 28, 135,
        124, 73, 143, 49, 166, 91, 165, 21, 46, 48, 198, 17, 178, 197, 93, 99,
        160,
      ],
      [
        233, 206, 59, 221, 104, 149, 222, 77, 164, 161, 179, 193, 251, 13, 182,
        232, 23, 206, 53, 8, 185, 206, 48, 148, 5, 70, 218, 15, 27, 209, 134,
        230,
      ],
      [
        182, 224, 192, 203, 65, 30, 57, 3, 19, 229, 229, 153, 47, 34, 38, 154,
        100, 242, 241, 250, 78, 156, 73, 53, 15, 171, 69, 55, 220, 64, 189, 237,
      ],
    ],
  },
  {
    // tree node hash: C94ftStYh3afdysMEnf4KGMvyQZVcMY6P16UkEJGkYbU
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer1,
      stakeAuthority: stakeAuthority,
      voteAccount: voteAccount2,
      claim: 69,
    }),
    proof: [
      [
        14, 235, 255, 251, 170, 3, 134, 248, 124, 209, 130, 237, 93, 49, 147,
        60, 190, 245, 185, 158, 240, 4, 61, 255, 78, 190, 156, 200, 63, 34, 150,
        164,
      ],
      [
        233, 206, 59, 221, 104, 149, 222, 77, 164, 161, 179, 193, 251, 13, 182,
        232, 23, 206, 53, 8, 185, 206, 48, 148, 5, 70, 218, 15, 27, 209, 134,
        230,
      ],
      [
        182, 224, 192, 203, 65, 30, 57, 3, 19, 229, 229, 153, 47, 34, 38, 154,
        100, 242, 241, 250, 78, 156, 73, 53, 15, 171, 69, 55, 220, 64, 189, 237,
      ],
    ],
  },
  {
    // tree node hash: C6NjywmM6srH8Cseo54Z8QAEy9AiLieZfjoY3T3Whs5u
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer2,
      stakeAuthority: stakeAuthority,
      voteAccount: voteAccount2,
      claim: 111111,
    }),
    proof: [
      [
        87, 41, 78, 249, 13, 135, 246, 151, 182, 238, 24, 189, 251, 31, 17, 120,
        86, 4, 197, 104, 125, 233, 45, 57, 231, 65, 47, 62, 60, 48, 23, 255,
      ],
      [
        107, 203, 36, 243, 106, 11, 123, 124, 149, 146, 17, 62, 69, 61, 118,
        216, 56, 237, 60, 229, 134, 112, 212, 122, 53, 148, 253, 102, 29, 41,
        28, 194,
      ],
      [
        208, 246, 91, 69, 231, 73, 127, 128, 24, 73, 222, 95, 51, 169, 125, 145,
        242, 101, 0, 85, 51, 207, 115, 155, 0, 69, 195, 84, 240, 145, 187, 177,
      ],
    ],
  },
]

export const treeNodesVoteAccount1 = ITEMS.filter(item =>
  item.treeNode.data.voteAccount.equals(voteAccount1)
)
export const totalClaimVoteAccount1 = treeNodesVoteAccount1.reduce(
  (acc, item) => acc.add(item.treeNode.data.claim),
  new BN(0)
)
export const treeNodesVoteAccount2 = ITEMS.filter(item =>
  item.treeNode.data.voteAccount.equals(voteAccount2)
)
export const totalClaimVoteAccount2 = treeNodesVoteAccount2.reduce(
  (acc, item) => acc.add(item.treeNode.data.claim),
  new BN(0)
)

export function treeNodeBy(
  voteAccount: PublicKey,
  withdrawer: PublicKey
): {
  treeNode: MerkleTreeNode
  proof: number[][]
} {
  const treeNodesFiltered = ITEMS.filter(item =>
    item.treeNode.data.voteAccount.equals(voteAccount)
  )
  const treeNodesByWithdrawer = treeNodesFiltered.filter(r =>
    r.treeNode.data.withdrawAuthority.equals(withdrawer)
  )
  expect(treeNodesByWithdrawer.length).toBe(1)
  return treeNodesByWithdrawer[0]
}
