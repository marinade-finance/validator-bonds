import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes'
import { MerkleTreeNode } from '../../src'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import BN from 'bn.js'
import { ExtendedProvider } from '@marinade.finance/web3js-common'
import { createUserAndFund } from '@marinade.finance/web3js-common'

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
export const withdrawer4 = new PublicKey(
  'DdWhr91hqajDZRaRVt4QhD5yJasjmyeweST5VUbfCKGy'
)
export const withdrawer4Keypair = Keypair.fromSecretKey(
  new Uint8Array([
    137, 198, 40, 27, 37, 227, 249, 231, 34, 199, 32, 244, 110, 23, 214, 53, 74,
    169, 123, 60, 47, 124, 240, 31, 152, 202, 22, 22, 219, 120, 37, 14, 187,
    166, 189, 44, 111, 242, 7, 250, 248, 14, 163, 244, 255, 202, 153, 170, 45,
    159, 43, 102, 71, 254, 58, 222, 149, 1, 233, 215, 141, 139, 98, 62,
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

// To get GENERATED new values for the following constants,
// see merkle_tree_collection.rs, `cargo test --package bid-psr-distribution -- --show-output --nocapture`

export type MerkleTreeNodeWithProof = {
  treeNode: MerkleTreeNode
  proof: number[][]
}

export const MERKLE_PROOF_VOTE_ACCOUNT_1 =
  'HKerG5LfsZVyV8o5pJCQa9UGcBwoNdpprgNEhF6Jqkkn'
export const MERKLE_ROOT_VOTE_ACCOUNT_1_BUF = bs58.decode(
  MERKLE_PROOF_VOTE_ACCOUNT_1
)
export const ITEMS_VOTE_ACCOUNT_1: MerkleTreeNodeWithProof[] = [
  {
    // tree node hash: 4PucYBabMwwrLAnaaSUSJ26z5fNNB4XUeje86fS2B9Qx
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer1,
      stakeAuthority: staker1,
      claim: 1234,
      index: 0,
    }),
    proof: [
      [
        197, 215, 216, 177, 226, 233, 131, 55, 30, 55, 145, 193, 203, 8, 172,
        54, 161, 178, 68, 93, 58, 233, 183, 5, 81, 143, 67, 11, 144, 98, 132,
        137,
      ],
      [
        220, 127, 95, 78, 104, 53, 234, 178, 46, 157, 232, 34, 16, 61, 130, 180,
        183, 133, 153, 141, 68, 156, 40, 168, 250, 0, 244, 43, 36, 88, 152, 16,
      ],
      [
        117, 142, 190, 150, 137, 61, 245, 136, 40, 6, 15, 133, 238, 134, 130,
        53, 250, 67, 178, 165, 144, 13, 42, 226, 230, 82, 92, 43, 252, 61, 179,
        163,
      ],
    ],
  },
  {
    // tree node hash: 2KhcqeCqd1ELdf2YzMScL5fQWFcQSWpyKPvY7fwRbh9n
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer2,
      stakeAuthority: staker1,
      claim: 99999,
      index: 1,
    }),
    proof: [
      [
        118, 0, 116, 6, 0, 13, 25, 3, 71, 165, 234, 5, 162, 218, 61, 200, 160,
        191, 222, 114, 84, 70, 228, 157, 236, 251, 208, 225, 239, 138, 237, 238,
      ],
      [
        220, 127, 95, 78, 104, 53, 234, 178, 46, 157, 232, 34, 16, 61, 130, 180,
        183, 133, 153, 141, 68, 156, 40, 168, 250, 0, 244, 43, 36, 88, 152, 16,
      ],
      [
        117, 142, 190, 150, 137, 61, 245, 136, 40, 6, 15, 133, 238, 134, 130,
        53, 250, 67, 178, 165, 144, 13, 42, 226, 230, 82, 92, 43, 252, 61, 179,
        163,
      ],
    ],
  },
  {
    // tree node hash: GkQwx28pnRGZ8C4AjTtae9g5wkLd9ujfeh3KGW6A6qmF
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer3,
      stakeAuthority: staker2,
      claim: 212121,
      index: 2,
    }),
    proof: [
      [
        194, 77, 203, 25, 185, 65, 114, 49, 28, 101, 229, 249, 193, 201, 89, 80,
        131, 70, 6, 162, 107, 84, 254, 208, 195, 2, 28, 90, 107, 228, 226, 175,
      ],
      [
        112, 146, 96, 170, 138, 71, 63, 26, 19, 210, 51, 219, 11, 29, 109, 147,
        10, 201, 237, 165, 97, 98, 68, 235, 44, 161, 191, 214, 14, 23, 228, 13,
      ],
      [
        117, 142, 190, 150, 137, 61, 245, 136, 40, 6, 15, 133, 238, 134, 130,
        53, 250, 67, 178, 165, 144, 13, 42, 226, 230, 82, 92, 43, 252, 61, 179,
        163,
      ],
    ],
  },
  {
    // tree node hash: DKaMUwd9pgM6BAyiKuAWXkFnsGmNcHpNHt7XtQ7rhPDy
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer4,
      stakeAuthority: staker2,
      claim: LAMPORTS_PER_SOL,
      index: 3,
    }),
    proof: [
      [
        217, 39, 5, 248, 152, 229, 95, 48, 55, 18, 32, 60, 138, 89, 60, 104,
        216, 233, 174, 157, 85, 225, 79, 206, 245, 38, 93, 69, 163, 188, 138,
        253,
      ],
      [
        112, 146, 96, 170, 138, 71, 63, 26, 19, 210, 51, 219, 11, 29, 109, 147,
        10, 201, 237, 165, 97, 98, 68, 235, 44, 161, 191, 214, 14, 23, 228, 13,
      ],
      [
        117, 142, 190, 150, 137, 61, 245, 136, 40, 6, 15, 133, 238, 134, 130,
        53, 250, 67, 178, 165, 144, 13, 42, 226, 230, 82, 92, 43, 252, 61, 179,
        163,
      ],
    ],
  },
  {
    // tree node hash: A7vd2j3JamYgHcdFtdMgSbeTcVpu1gh1o73RsvcguWAH
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer4,
      stakeAuthority: staker3,
      claim: 42 * LAMPORTS_PER_SOL,
      index: 4,
    }),
    proof: [
      [
        250, 102, 44, 164, 200, 63, 106, 128, 73, 116, 230, 89, 84, 247, 45, 7,
        141, 85, 3, 242, 140, 130, 56, 128, 222, 120, 3, 21, 2, 77, 235, 230,
      ],
      [
        235, 167, 4, 30, 121, 49, 252, 253, 81, 195, 170, 97, 232, 237, 22, 2,
        96, 190, 15, 225, 92, 202, 105, 91, 170, 106, 97, 249, 42, 121, 92, 9,
      ],
      [
        94, 191, 23, 124, 113, 156, 217, 199, 75, 31, 123, 137, 169, 36, 45,
        157, 126, 9, 97, 14, 150, 13, 214, 55, 94, 0, 104, 250, 246, 202, 246,
        76,
      ],
    ],
  },
]

export const MERKLE_PROOF_VOTE_ACCOUNT_2 =
  'SA4YRkCch9fKu2RKEJ37LXzZY7DEYJiMNEgy6EKxo6C'
export const MERKLE_ROOT_VOTE_ACCOUNT_2_BUF = bs58.decode(
  MERKLE_PROOF_VOTE_ACCOUNT_2
)
export const ITEMS_VOTE_ACCOUNT_2: MerkleTreeNodeWithProof[] = [
  {
    // tree node hash: DCLYv1hd1SQ8BoHmSVsriYLZNUGKbCWnBub4z95vtd9L
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer1,
      stakeAuthority: staker2,
      claim: 69,
      index: 3,
    }),
    proof: [
      [
        244, 133, 4, 76, 85, 119, 121, 189, 241, 204, 236, 248, 11, 168, 245,
        186, 213, 206, 63, 58, 197, 3, 58, 151, 91, 60, 114, 233, 100, 203, 201,
        187,
      ],
    ],
  },
  {
    // tree node hash: CrgDn9vsBDEyxaxBWPV74LZHbgTVonmYJv3DWSLiQ7HN
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer2,
      stakeAuthority: staker3,
      claim: 111111,
      index: 4,
    }),
    proof: [
      [
        223, 236, 138, 244, 74, 160, 22, 200, 31, 98, 70, 43, 48, 36, 104, 248,
        252, 74, 206, 145, 92, 139, 12, 84, 68, 216, 52, 148, 31, 60, 185, 44,
      ],
    ],
  },
]

export const MERKLE_PROOF_OPERATOR =
  '2aKJRJBGzx19JdM1MHWrL2QwNduYobiHmsoVxKX3BRfu'
export const MERKLE_ROOT_VOTE_OPERATOR_BUF = bs58.decode(MERKLE_PROOF_OPERATOR)
export const ITEMS_OPERATOR: MerkleTreeNodeWithProof[] = [
  {
    // tree node hash: 6DrvQrbFPmsJVny4rLeRh9DxtESRnkyqqeg4wW3zhsko
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer1,
      stakeAuthority: staker2,
      claim: 556677,
      index: 0,
    }),
    proof: [
      [
        35, 102, 250, 217, 79, 114, 190, 155, 248, 240, 82, 61, 66, 35, 106, 13,
        31, 109, 17, 142, 41, 54, 249, 133, 119, 101, 85, 40, 180, 226, 181,
        236,
      ],
    ],
  },
  {
    // tree node hash: 3QGxh9aCvDsfksXaPkW5exLXf86WeZcyyYssxX9HPaK9
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer2,
      stakeAuthority: staker3,
      claim: 996677,
      index: 1,
    }),
    proof: [
      [
        232, 146, 110, 26, 37, 223, 4, 198, 196, 179, 65, 57, 37, 235, 223, 13,
        182, 19, 214, 77, 252, 243, 28, 184, 213, 215, 30, 189, 235, 33, 224,
        143,
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
  const treeNodesByWithdrawer = treeNodeList
    .map((item, index) => {
      return { item, index }
    })
    .find(({ item }) => item.treeNode.data.withdrawAuthority.equals(withdrawer))
  if (!treeNodesByWithdrawer) {
    throw new Error(
      `tree node for withdrawer ${withdrawer.toBase58()} not found`
    )
  }
  return treeNodesByWithdrawer.item
}

export async function createWithdrawerUsers(provider: ExtendedProvider) {
  let exists = false
  try {
    exists = (await provider.connection.getAccountInfo(withdrawer1)) !== null
  } catch (e) {
    exists = false
  }
  if (exists === false) {
    await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL,
      user: withdrawer1Keypair,
    })
    await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL,
      user: withdrawer2Keypair,
    })
    await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL,
      user: withdrawer3Keypair,
    })
  }
}
