import { base64, bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes'
import { PublicKey } from '@solana/web3.js'
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
  stakeAuthority: PublicKey
  withdrawAuthority: PublicKey
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

  public static fromString({
    stakeAuthority,
    withdrawAuthority,
    claim,
  }: {
    stakeAuthority: string
    withdrawAuthority: string
    claim: BN | number
  }): MerkleTreeNode {
    return new MerkleTreeNode({
      stakeAuthority: new PublicKey(stakeAuthority),
      withdrawAuthority: new PublicKey(withdrawAuthority),
      claim,
    })
  }

  get stakeAuthority(): PublicKey {
    return new PublicKey(this.data.stakeAuthority)
  }

  get withdrawAuthority(): PublicKey {
    return new PublicKey(this.data.withdrawAuthority)
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
  }: {
    stakeAuthority: string
    withdrawAuthority: string
    claim: BN | number
  }): MerkleTreeNodeEncoded {
    return MerkleTreeNode.fromString({
      stakeAuthority,
      withdrawAuthority,
      claim,
    }).hash()
  }

  public static hash({
    stakeAuthority,
    withdrawAuthority,
    claim,
  }: MerkleTreeNodeDataInput): MerkleTreeNodeEncoded {
    const sha256 = CryptoJS.algo.SHA256.create()
    sha256.update(pubkeyToWordArray(stakeAuthority))
    sha256.update(pubkeyToWordArray(withdrawAuthority))
    claim = new BN(claim)
    sha256.update(
      CryptoJS.enc.Hex.parse(claim.toBuffer('le', 8).toString('hex'))
    )
    const wordArray = sha256.finalize()
    return MerkleTreeNode.toEncodings(wordArray)
  }

  public static hashLeafNode({
    stakeAuthority,
    withdrawAuthority,
    claim,
  }: MerkleTreeNodeDataInput): MerkleTreeNodeEncoded {
    const resultHash = MerkleTreeNode.hash({
      stakeAuthority,
      withdrawAuthority,
      claim,
    })
    return MerkleTreeNode.hashLeafNodeFromBuffer(resultHash)
  }

  public static hashLeafNodeFromBuffer({
    buffer,
  }: MerkleTreeNodeEncoded): MerkleTreeNodeEncoded {
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

/**
 * Returns a crypto-JS compatible Word Array, based on the byte array provided.
 * https://gist.github.com/artjomb/7ef1ee574a411ba0dd1933c1ef4690d1?permalink_comment_id=4759901#gistcomment-4759901
 **/
export function toWordArray(bytes: number[]) {
  const words: number[] = []
  for (let j = 0; j < bytes.length; j++) {
    words[j >>> 2] |= bytes[j] << (24 - 8 * (j % 4))
  }
  return CryptoJS.lib.WordArray.create(words, bytes.length)
}

export function pubkeyToWordArray(pubkey: PublicKey) {
  return toWordArray(Array.from(pubkey.toBuffer()))
}
