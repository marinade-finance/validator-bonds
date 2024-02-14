import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes'
import { MerkleTreeNode, withdrawerAuthority } from '../../src'
import { Keypair, PublicKey } from '@solana/web3.js'
import BN from 'bn.js'

export const MERKLE_PROOF = 'CJWSpJD2yeL1JPUH9pyfAefFetdiSuvPNCqq5LfQ71je'
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

// TODO: delete me
// new PublicKey(9bvgE5dz7cKi2774nrEAW26b8r9YecH3Xzk7ZJFinBgi
// )
// Keypair.fromSecretKey(new Uint8Array([205,234,126,103,105,119,64,125,57,229,49,149,89,113,100,223,223,177,205,41,234,133,82,48,87,135,73,64,178,229,174,135,127,207,239,86,25,196,108,213,181,212,252,208,208,204,247,56,222,91,180,18,20,249,217,138,84,102,21,135,66,73,221,255]))
// new PublicKey(DVamVtXcmLMJEGb81HkLcgdppGBuN5GqjL5PWGnWAN4t
// )
// Keypair.fromSecretKey(new Uint8Array([14,213,177,117,226,3,88,196,31,5,84,164,111,252,169,144,70,142,160,201,184,18,245,59,6,182,43,207,158,194,125,154,185,158,175,188,200,211,91,132,140,157,16,95,36,251,31,216,65,16,30,227,146,221,222,205,173,210,154,59,39,97,208,109]))
// new PublicKey(9hiL6DJDzYZHvPGgvNGT14XwwwdkV7fhTuUBZoKimQWD
// )
// Keypair.fromSecretKey(new Uint8Array([221,116,216,250,193,38,81,209,120,48,2,1,210,47,73,190,244,125,94,160,69,251,53,115,229,17,164,105,173,171,236,26,129,75,117,114,94,94,130,230,188,184,76,171,189,237,43,232,198,89,239,254,114,64,69,17,2,104,251,222,43,147,40,10]))
// new PublicKey(G4C91n221dSr7Pip591hhMp9vXDbobX98PT8uAxhM4kB
// )
// Keypair.fromSecretKey(new Uint8Array([238,106,132,88,200,237,6,169,64,232,243,104,168,64,238,231,111,255,218,30,226,30,79,75,2,190,87,123,245,220,103,68,223,176,163,233,136,43,221,240,98,54,247,113,189,34,250,224,58,157,91,232,100,232,6,95,158,100,36,209,105,149,1,116]))
// new PublicKey(5vGBkuJSpdaCdrZkTrhdwWZJESu14X5w3Naq6dPkm6Az
// )
// Keypair.fromSecretKey(new Uint8Array([165,72,173,177,206,64,255,239,247,137,231,194,227,101,25,217,35,82,2,55,229,130,110,32,241,36,104,132,245,67,211,214,73,19,179,106,157,62,20,215,18,17,143,217,8,24,111,202,241,21,94,23,38,25,182,76,86,4,161,145,92,251,51,199]))
// new PublicKey(FZryDKqbsZRYXjvrz16N28eHaWBJGGk8DZyAGxJjJ1R1
// )
//   export const configAccount2 = new PublicKey('FmS9SKrALCkuxfEDhwk52Fi9614xhScF2PHSrQoZmmEY')
// export const configAccount2Keypair = Keypair.fromSecretKey(new Uint8Array([128,56,10,62,22,237,67,32,128,93,175,52,51,181,21,157,163,21,108,146,70,89,249,98,54,60,166,14,18,135,222,182,219,101,154,201,2,129,96,1,202,71,74,207,63,104,143,129,128,235,44,246,89,173,189,55,102,107,241,202,182,150,52,33]))
// export const stakeAuthority2 = withdrawerAuthority(configAccount2)

export const ITEMS: { treeNode: MerkleTreeNode; proof: number[][] }[] = [
  {
    // tree node hash: CUgEsyuML4P22hjkvmU6MRHi5jHvpPaB7UvD5t1V4uFc
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer1.toBase58(),
      stakeAuthority: stakeAuthority.toBase58(),
      voteAccount: voteAccount1.toBase58(),
      claim: 1234,
    }),
    proof: [
      [
        131, 152, 159, 242, 119, 184, 154, 81, 208, 199, 41, 49, 231, 168, 233,
        237, 3, 179, 126, 106, 23, 135, 213, 74, 127, 83, 255, 105, 86, 250, 63,
        23,
      ],
      [
        113, 143, 128, 112, 238, 209, 97, 96, 248, 220, 18, 78, 229, 222, 253,
        207, 114, 129, 14, 161, 181, 23, 254, 81, 84, 119, 196, 162, 86, 45,
        205, 54,
      ],
      [
        147, 52, 104, 182, 174, 190, 248, 228, 27, 240, 240, 245, 6, 218, 13,
        196, 53, 63, 242, 117, 208, 239, 15, 106, 255, 30, 248, 47, 107, 170,
        233, 94,
      ],
    ],
  },
  {
    // tree node hash: 3pwY1X2iV6vofeswACq53ywUE55Ux8BBY5EwxXApi3rA
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer2.toBase58(),
      stakeAuthority: stakeAuthority.toBase58(),
      voteAccount: voteAccount1.toBase58(),
      claim: 99999,
    }),
    proof: [
      [
        230, 150, 49, 236, 10, 41, 122, 129, 64, 55, 46, 243, 120, 207, 147,
        226, 10, 100, 14, 160, 68, 85, 238, 179, 252, 103, 90, 71, 63, 137, 115,
        100,
      ],
      [
        113, 143, 128, 112, 238, 209, 97, 96, 248, 220, 18, 78, 229, 222, 253,
        207, 114, 129, 14, 161, 181, 23, 254, 81, 84, 119, 196, 162, 86, 45,
        205, 54,
      ],
      [
        147, 52, 104, 182, 174, 190, 248, 228, 27, 240, 240, 245, 6, 218, 13,
        196, 53, 63, 242, 117, 208, 239, 15, 106, 255, 30, 248, 47, 107, 170,
        233, 94,
      ],
    ],
  },
  {
    // tree node hash: EtS2pCv7w21NaRUdgd11ECSbrLrYezNgJqPbki6GC3hj
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer3.toBase58(),
      stakeAuthority: stakeAuthority.toBase58(),
      voteAccount: voteAccount1.toBase58(),
      claim: 212121,
    }),
    proof: [
      [
        56, 7, 110, 103, 58, 212, 164, 78, 150, 160, 80, 24, 209, 221, 112, 197,
        170, 62, 83, 209, 7, 111, 140, 113, 52, 73, 3, 38, 135, 169, 19, 181,
      ],
      [
        190, 99, 233, 8, 249, 68, 135, 70, 128, 15, 2, 169, 47, 194, 102, 12,
        200, 64, 213, 103, 134, 64, 112, 215, 201, 36, 212, 236, 32, 93, 76,
        106,
      ],
      [
        147, 52, 104, 182, 174, 190, 248, 228, 27, 240, 240, 245, 6, 218, 13,
        196, 53, 63, 242, 117, 208, 239, 15, 106, 255, 30, 248, 47, 107, 170,
        233, 94,
      ],
    ],
  },
  {
    // tree node hash: C94ftStYh3afdysMEnf4KGMvyQZVcMY6P16UkEJGkYbU
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer1.toBase58(),
      stakeAuthority: stakeAuthority.toBase58(),
      voteAccount: voteAccount2.toBase58(),
      claim: 69,
    }),
    proof: [
      [
        217, 141, 69, 36, 65, 205, 32, 76, 165, 35, 197, 94, 188, 141, 93, 158,
        129, 239, 253, 174, 42, 156, 151, 29, 197, 253, 160, 116, 10, 112, 12,
        10,
      ],
      [
        190, 99, 233, 8, 249, 68, 135, 70, 128, 15, 2, 169, 47, 194, 102, 12,
        200, 64, 213, 103, 134, 64, 112, 215, 201, 36, 212, 236, 32, 93, 76,
        106,
      ],
      [
        147, 52, 104, 182, 174, 190, 248, 228, 27, 240, 240, 245, 6, 218, 13,
        196, 53, 63, 242, 117, 208, 239, 15, 106, 255, 30, 248, 47, 107, 170,
        233, 94,
      ],
    ],
  },
  {
    // tree node hash: C6NjywmM6srH8Cseo54Z8QAEy9AiLieZfjoY3T3Whs5u
    treeNode: new MerkleTreeNode({
      withdrawAuthority: withdrawer2.toBase58(),
      stakeAuthority: stakeAuthority.toBase58(),
      voteAccount: voteAccount2.toBase58(),
      claim: 111111,
    }),
    proof: [
      [
        11, 90, 12, 238, 182, 194, 37, 113, 192, 160, 195, 72, 154, 15, 243,
        131, 143, 156, 169, 22, 83, 184, 141, 22, 119, 27, 143, 77, 156, 9, 216,
        244,
      ],
      [
        41, 234, 24, 0, 236, 27, 21, 81, 222, 105, 251, 199, 172, 210, 12, 100,
        139, 85, 239, 237, 217, 227, 55, 20, 103, 35, 170, 84, 91, 184, 224,
        200,
      ],
      [
        44, 180, 56, 187, 76, 83, 100, 85, 154, 245, 73, 252, 42, 103, 30, 96,
        53, 35, 46, 47, 17, 67, 81, 88, 202, 55, 44, 61, 55, 49, 144, 165,
      ],
    ],
  },
]

export const treeNodesVoteAccount1 = ITEMS.filter(
  item => item.treeNode.data.voteAccount === voteAccount1.toBase58()
)
export const totalClaimVoteAccount1 = treeNodesVoteAccount1.reduce(
  (acc, item) => acc.add(item.treeNode.data.claim),
  new BN(0)
)
export const treeNodesVoteAccount2 = ITEMS.filter(
  item => item.treeNode.data.voteAccount === voteAccount2.toBase58()
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
  const treeNodesFiltered = ITEMS.filter(
    item => item.treeNode.data.voteAccount === voteAccount.toBase58()
  )
  const treeNodesByWithdrawer = treeNodesFiltered.filter(
    r => r.treeNode.data.withdrawAuthority === withdrawer.toBase58()
  )
  expect(treeNodesByWithdrawer.length).toBe(1)
  return treeNodesByWithdrawer[0]
}
