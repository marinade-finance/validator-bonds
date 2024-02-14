import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes'
import { MerkleTreeNode } from '../../src'
import { Keypair, PublicKey } from '@solana/web3.js'
import BN from 'bn.js'

export const MERKLE_PROOF = '7iF4883Y16rWHqYrtdmn6ykvV7NvGsbibnmZwBanojZD'
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

export const ITEMS: { treeNode: MerkleTreeNode; proof: number[][] }[] = [
  {
    // tree node hash: 2dGWvEq6Pan1RrZEmZ4rHLGYNp1UKnjPGdFJN3RNBdaS
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer1,
      stakeAuthority: staker1,
      voteAccount: voteAccount1,
      claim: 1234,
    }),
    proof: [
      [
        169, 26, 178, 243, 186, 171, 226, 253, 126, 24, 48, 24, 87, 176, 105,
        156, 88, 12, 166, 157, 3, 129, 113, 187, 112, 251, 157, 67, 123, 111,
        11, 42,
      ],
      [
        160, 80, 88, 229, 37, 37, 166, 177, 134, 144, 148, 221, 108, 200, 28,
        117, 46, 163, 221, 16, 166, 40, 23, 122, 236, 212, 191, 161, 0, 96, 197,
        41,
      ],
      [
        50, 84, 55, 143, 145, 207, 177, 140, 121, 48, 154, 231, 228, 146, 128,
        129, 109, 238, 21, 147, 193, 20, 211, 35, 91, 110, 234, 233, 216, 242,
        115, 139,
      ],
    ],
  },
  {
    // tree node hash: ESMSf44cswZvXejW8dVhsjyyULW5nSzTHBmuMNFvg2vk
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer2,
      stakeAuthority: staker1,
      voteAccount: voteAccount1,
      claim: 99999,
    }),
    proof: [
      [
        119, 156, 202, 137, 163, 63, 23, 86, 50, 219, 67, 8, 215, 146, 238, 35,
        131, 195, 214, 123, 186, 22, 211, 75, 139, 20, 176, 104, 252, 249, 60,
        217,
      ],
      [
        160, 80, 88, 229, 37, 37, 166, 177, 134, 144, 148, 221, 108, 200, 28,
        117, 46, 163, 221, 16, 166, 40, 23, 122, 236, 212, 191, 161, 0, 96, 197,
        41,
      ],
      [
        50, 84, 55, 143, 145, 207, 177, 140, 121, 48, 154, 231, 228, 146, 128,
        129, 109, 238, 21, 147, 193, 20, 211, 35, 91, 110, 234, 233, 216, 242,
        115, 139,
      ],
    ],
  },
  {
    // tree node hash: HCRaDeQzb2vj4TAws7CeovFFuzwBRPCzkywMxBb1JNuv
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer3,
      stakeAuthority: staker2,
      voteAccount: voteAccount1,
      claim: 212121,
    }),
    proof: [
      [
        105, 141, 203, 134, 62, 190, 81, 135, 124, 70, 230, 140, 228, 49, 6, 99,
        193, 37, 218, 255, 253, 241, 17, 169, 68, 85, 16, 86, 195, 120, 82, 207,
      ],
      [
        142, 87, 6, 188, 247, 130, 118, 126, 114, 53, 119, 53, 122, 77, 255,
        252, 245, 144, 152, 115, 162, 1, 194, 60, 56, 132, 11, 133, 160, 91,
        142, 32,
      ],
      [
        50, 84, 55, 143, 145, 207, 177, 140, 121, 48, 154, 231, 228, 146, 128,
        129, 109, 238, 21, 147, 193, 20, 211, 35, 91, 110, 234, 233, 216, 242,
        115, 139,
      ],
    ],
  },
  {
    // tree node hash: 2g6GGBps8fTTq9DvJHwBxNC57k5REDFbjebWYyw9qDYQ
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer1,
      stakeAuthority: staker2,
      voteAccount: voteAccount2,
      claim: 69,
    }),
    proof: [
      [
        43, 115, 25, 67, 8, 94, 86, 102, 222, 131, 96, 254, 188, 172, 164, 179,
        156, 92, 79, 248, 195, 120, 183, 106, 96, 38, 120, 23, 59, 195, 169,
        208,
      ],
      [
        159, 219, 61, 246, 151, 49, 200, 46, 195, 10, 112, 214, 44, 95, 201, 51,
        28, 38, 135, 106, 58, 162, 239, 247, 191, 121, 138, 103, 191, 34, 100,
        153,
      ],
      [
        96, 247, 12, 68, 67, 41, 253, 26, 149, 121, 158, 236, 188, 56, 19, 184,
        242, 63, 242, 61, 147, 50, 119, 26, 21, 76, 36, 242, 151, 143, 142, 182,
      ],
    ],
  },
  {
    // tree node hash: FacAU7ukxtPkBfNWb73ehLWDfA5cVf7DdahcCZypsJVg
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer2,
      stakeAuthority: staker3,
      voteAccount: voteAccount2,
      claim: 111111,
    }),
    proof: [
      [
        219, 108, 143, 16, 1, 187, 27, 244, 73, 6, 252, 226, 137, 13, 210, 10,
        113, 66, 22, 31, 9, 23, 170, 45, 164, 229, 135, 182, 130, 139, 181, 214,
      ],
      [
        74, 28, 21, 109, 68, 162, 237, 114, 228, 131, 232, 33, 131, 96, 69, 2,
        11, 214, 66, 255, 130, 139, 179, 101, 48, 83, 161, 26, 22, 8, 181, 47,
      ],
      [
        176, 158, 184, 236, 180, 37, 222, 250, 206, 40, 15, 165, 108, 179, 63,
        73, 247, 165, 233, 98, 240, 90, 209, 68, 208, 232, 13, 183, 48, 14, 147,
        6,
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
