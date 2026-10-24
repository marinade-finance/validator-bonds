import { createHash } from 'crypto'

import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes'
import { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'

export const LEAF_NODE_PREFIX = new BN(0)
export const LEAF_NODE_PREFIX_BUF = Buffer.alloc(
  1,
  LEAF_NODE_PREFIX.toBuffer('le', 1),
)
export const INTERMEDIATE_NODE_PREFIX = new BN(1)
export const INTERMEDIATE_NODE_PREFIX_BUF = Buffer.alloc(
  1,
  INTERMEDIATE_NODE_PREFIX.toBuffer('le', 1),
)

export type MerkleTreeNodeEncoded = {
  base58: string
  base64: string
  buffer: Buffer
  words: number[]
}

type MerkleTreeNodeDataInput = {
  stakeAuthority: PublicKey
  withdrawAuthority: PublicKey
  claim: BN | number
  index: BN | number
}

export type MerkleTreeNodeData = MerkleTreeNodeDataInput &
  Omit<MerkleTreeNodeDataInput, 'claim' | 'index'> & { claim: BN } & {
    index: BN
  }

// see settlement_engine/src/merkle_tree_collection.rs
export class MerkleTreeNode {
  public data: MerkleTreeNodeData
  constructor(data: MerkleTreeNodeDataInput) {
    this.data = {
      ...data,
      claim: new BN(data.claim),
      index: new BN(data.index),
    }
  }

  public static fromString({
    stakeAuthority,
    withdrawAuthority,
    claim,
    index,
  }: {
    stakeAuthority: string
    withdrawAuthority: string
    claim: BN | number
    index: BN | number
  }): MerkleTreeNode {
    return new MerkleTreeNode({
      stakeAuthority: new PublicKey(stakeAuthority),
      withdrawAuthority: new PublicKey(withdrawAuthority),
      claim,
      index,
    })
  }

  get stakeAuthority(): PublicKey {
    return new PublicKey(this.data.stakeAuthority)
  }

  get withdrawAuthority(): PublicKey {
    return new PublicKey(this.data.withdrawAuthority)
  }

  get index(): BN {
    return new BN(this.data.index)
  }

  get claim(): BN {
    return new BN(this.data.claim)
  }

  public hash(): MerkleTreeNodeEncoded {
    return MerkleTreeNode.hash(this.data)
  }

  public hashLeafNode(): MerkleTreeNodeEncoded {
    return MerkleTreeNode.hashLeafNode(this.data)
  }

  public static hashFromString({
    stakeAuthority,
    withdrawAuthority,
    claim,
    index,
  }: {
    stakeAuthority: string
    withdrawAuthority: string
    claim: BN | number
    index: BN | number
  }): MerkleTreeNodeEncoded {
    return MerkleTreeNode.fromString({
      stakeAuthority,
      withdrawAuthority,
      claim,
      index,
    }).hash()
  }

  public static hash({
    stakeAuthority,
    withdrawAuthority,
    claim,
    index,
  }: MerkleTreeNodeDataInput): MerkleTreeNodeEncoded {
    const sha256 = createHash('sha256')
    sha256.update(stakeAuthority.toBuffer())
    sha256.update(withdrawAuthority.toBuffer())
    sha256.update(new BN(claim).toBuffer('le', 8))
    sha256.update(new BN(index).toBuffer('le', 8))
    return MerkleTreeNode.toEncodings(sha256.digest())
  }

  public static hashLeafNode({
    stakeAuthority,
    withdrawAuthority,
    claim,
    index,
  }: MerkleTreeNodeDataInput): MerkleTreeNodeEncoded {
    const resultHash = MerkleTreeNode.hash({
      stakeAuthority,
      withdrawAuthority,
      claim,
      index,
    })
    return MerkleTreeNode.hashLeafNodeFromBuffer(resultHash)
  }

  public static hashLeafNodeFromBuffer({
    buffer,
  }: MerkleTreeNodeEncoded): MerkleTreeNodeEncoded {
    const prolongedBuffer = Buffer.concat([LEAF_NODE_PREFIX_BUF, buffer])
    const digest = createHash('sha256').update(prolongedBuffer).digest()
    return MerkleTreeNode.toEncodings(digest)
  }

  public static toEncodings(buffer: Buffer): MerkleTreeNodeEncoded {
    return {
      base58: bs58.encode(buffer),
      base64: buffer.toString('base64'),
      buffer,
      words: Array.from(buffer),
    }
  }
}
