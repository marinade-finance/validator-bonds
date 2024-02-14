import { base64, bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes'
import BN from 'bn.js'
import CryptoJS from 'crypto-js'

export const LEAF_NODE_PREFIX = new BN(0)
export const LEAF_NODE_PREFIX_BUF = Buffer.alloc(
  1,
  LEAF_NODE_PREFIX.toBuffer('le', 1)
)
export const INTERMEDIATE_NODE_PREFIX = new BN(1)
export const INTERMEDIATE_NODE_PREFIX_BUF = Buffer.alloc(
  1,
  INTERMEDIATE_NODE_PREFIX.toBuffer('le', 1)
)

export type MerkleTreeNodeEncoded = {
  base58: string
  base64: string
  buffer: Buffer
  words: number[]
  wordArray: CryptoJS.lib.WordArray
}

type MerkleTreeNodeDataInput = {
  stakeAuthority: string
  withdrawAuthority: string
  voteAccount: string
  claim: BN | number
}

export type MerkleTreeNodeData = MerkleTreeNodeDataInput &
  Omit<MerkleTreeNodeDataInput, 'claim'> & { claim: BN }

// see insurance_engine/src/merkle_tree_collection.rs
export class MerkleTreeNode {
  public data: MerkleTreeNodeData
  constructor(data: MerkleTreeNodeDataInput) {
    this.data = {
      ...data,
      claim: new BN(data.claim),
    }
  }

  public hash(): MerkleTreeNodeEncoded {
    return MerkleTreeNode.hash(this.data)
  }

  public leafNodeHash(): MerkleTreeNodeEncoded {
    return MerkleTreeNode.leafNodeHash(this.data)
  }

  public static hash({
    stakeAuthority,
    withdrawAuthority,
    voteAccount,
    claim,
  }: MerkleTreeNodeDataInput): MerkleTreeNodeEncoded {
    const sha256 = CryptoJS.algo.SHA256.create()
    sha256.update(stakeAuthority)
    sha256.update(withdrawAuthority)
    sha256.update(voteAccount)
    claim = new BN(claim)
    sha256.update(
      CryptoJS.enc.Hex.parse(claim.toBuffer('le', 8).toString('hex'))
    )
    const wordArray = sha256.finalize()
    return MerkleTreeNode.toEncodings(wordArray)
  }

  public static leafNodeHash({
    stakeAuthority,
    withdrawAuthority,
    voteAccount,
    claim,
  }: MerkleTreeNodeDataInput): MerkleTreeNodeEncoded {
    const resultHash = MerkleTreeNode.hash({
      stakeAuthority,
      withdrawAuthority,
      voteAccount,
      claim,
    })
    return MerkleTreeNode.treeNodeFromHash(resultHash)
  }

  public static treeNodeFromHash({
    base58,
  }: MerkleTreeNodeEncoded): MerkleTreeNodeEncoded {
    const buffer: Buffer = bs58.decode(base58)
    const prolongedBuffer = Buffer.concat([LEAF_NODE_PREFIX_BUF, buffer])
    const sha256 = CryptoJS.algo.SHA256.create()
    sha256.update(CryptoJS.enc.Hex.parse(prolongedBuffer.toString('hex')))
    const wordArray = sha256.finalize()
    return MerkleTreeNode.toEncodings(wordArray)
  }

  private static toEncodings(
    wordArray: CryptoJS.lib.WordArray
  ): MerkleTreeNodeEncoded {
    const base64Hash = CryptoJS.enc.Base64.stringify(wordArray)
    const buffer = base64.decode(base64Hash)
    const base58Hash = bs58.encode(buffer)
    return {
      base58: base58Hash,
      base64: base64Hash,
      buffer,
      words: Array.from(buffer),
      wordArray,
    }
  }
}
