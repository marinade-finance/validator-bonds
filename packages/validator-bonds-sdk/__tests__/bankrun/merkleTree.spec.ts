import { MerkleTreeNode } from '../../src/merkleTree'

describe('Testing tree node creation', () => {
  // a cross check with the rust implementation (see merkle_tree_collection.rs)
  it('a tree node from pubkey', () => {
    const expectedNodeHash = '74QRV6rf48VigmAn2LFhVLYNY9xUZUJHtUuYaNAUsbQs'
    const expectedLeafHash = 'TTeK2Zkr8dXvw3njmKjvCqB6CiELB2L2wUKxQkaVbUR'

    const hash = MerkleTreeNode.hashFromString({
      stakeAuthority: 'EjeWgRiaawLSCUM7uojZgSnwipEiypS986yorgvfAzYW',
      withdrawAuthority: 'BT6Y2kX5RLhQ6DDzbjbiHNDyyWJgn9jp7g5rCFn8stqy',
      claim: 444,
      index: 222,
    })
    expect(expectedNodeHash).toEqual(hash.base58)

    const treeNode = MerkleTreeNode.hashLeafNodeFromBuffer(hash)
    expect(treeNode.base58).toEqual(expectedLeafHash)
  })
})
