import BN from 'bn.js'
import { MerkleTreeNode } from '../../src/merkleTree'

describe('Testing tree node creation', () => {
  // a cross check with the rust implementation (see merkle_tree_collection.rs)
  it('a tree node from pubkey', () => {
    const expectedNodeHash = 'A2grPmDuPXWQK2Qch7b2pj97SunPw3xjpxDV8efAtAZD'
    const hash = MerkleTreeNode.hashFromString({
      stakeAuthority: 'EjeWgRiaawLSCUM7uojZgSnwipEiypS986yorgvfAzYW',
      withdrawAuthority: 'BT6Y2kX5RLhQ6DDzbjbiHNDyyWJgn9jp7g5rCFn8stqy',
      claim: new BN(444),
    })
    expect(expectedNodeHash).toEqual(hash.base58)

    const expectedLeafHash = 'CRZSudMd4t7FWQnnpd8scbtrZepB7mMZa9HgBv2pkZRN'
    const treeNode = MerkleTreeNode.hashLeafNodeFromBuffer(hash)
    expect(treeNode.base58).toEqual(expectedLeafHash)
  })
})
