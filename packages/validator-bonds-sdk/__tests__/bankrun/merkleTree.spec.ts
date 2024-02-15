import BN from 'bn.js'
import { MerkleTreeNode } from '../../src/merkleTree'

describe('Testing tree node creation', () => {
  // a cross check with the rust implementation (see merkle_tree_collection.rs)
  it('a tree node from pubkey', () => {
    const expectedNodeHash = '4zDyYyE5oGrun3Uvfav5hVuRZbAf3a7tXkrgQFtj8XUm'
    const hash = MerkleTreeNode.hashFromString({
      stakeAuthority: 'EjeWgRiaawLSCUM7uojZgSnwipEiypS986yorgvfAzYW',
      withdrawAuthority: 'BT6Y2kX5RLhQ6DDzbjbiHNDyyWJgn9jp7g5rCFn8stqy',
      voteAccount: 'DYSosfmS9gp1hTY4jAdKJFWK3XHsemecgVPwjqgwM2Pb',
      claim: new BN(444),
    })
    expect(expectedNodeHash).toEqual(hash.base58)

    const expectedLeafHash = 'GjUZTX9QYsa84HuHHXQNJFghuh7aYuEhtoFEoNquTSuy'
    const treeNode = MerkleTreeNode.hashLeafNodeFromBuffer(hash)
    expect(treeNode.base58).toEqual(expectedLeafHash)
  })
})
