import BN from 'bn.js'
import { MerkleTreeNode } from '../../src/merkleTree'

describe('Testing tree node creation', () => {
  it('a hash from string', () => {
    // expected generated from the rust code:
    // TreeNode {
    //     stakeAuthority: "Solana".to_string(),
    //     withdrawAuthority: "blockchain".to_string(),
    //     voteAccount: "stars".to_string(),
    //     claim: 1,
    // }.hash()
    const expectedBase58 = 'BXWkZ8cyzndF9HJwMUYTCxDGv93kMaB8sGZQbLyL8NG'
    expect(expectedBase58).toEqual(
      MerkleTreeNode.hash({
        stakeAuthority: 'Solana',
        withdrawAuthority: 'blockchain',
        voteAccount: 'stars',
        claim: new BN(1),
      }).base58
    )

    expect('6hcVpnceUAJbAi4ScnMpQ7WPZXXiWkeX3PnZ97DRYYKC').toEqual(
      MerkleTreeNode.leafNodeHash({
        stakeAuthority: 'AshNazgDurbatuLk999999999999999999999999999',
        withdrawAuthority: 'AshNazgG1mbatuL9999999999999999999999999999',
        voteAccount: 'AshNazgThrakatuLuk99999999999999999999999999',
        claim: 69,
      }).base58
    )
    expect('Dz3iv3tvPSTjSsdZy4ft32GqYW6m3Tk63HnvMCmmAuBe').toEqual(
      MerkleTreeNode.hash({
        stakeAuthority: 'AshNazgDurbatuLk999999999999999999999999999',
        withdrawAuthority: 'AshNazgG1mbatuL9999999999999999999999999999',
        voteAccount: 'AshNazgThrakatuLuk99999999999999999999999999',
        claim: 69,
      }).base58
    )
  })

  it('a tree node from pubkey', () => {
    const expectedBase58 = '3LrYLzt4P6LJCyLsbYPAes4d5U8aohjbmW1dJvbrkdse'
    const hash = MerkleTreeNode.hash({
      stakeAuthority: 'EjeWgRiaawLSCUM7uojZgSnwipEiypS986yorgvfAzYW',
      withdrawAuthority: 'BT6Y2kX5RLhQ6DDzbjbiHNDyyWJgn9jp7g5rCFn8stqy',
      voteAccount: 'DYSosfmS9gp1hTY4jAdKJFWK3XHsemecgVPwjqgwM2Pb',
      claim: new BN(444),
    })
    expect(expectedBase58).toEqual(hash.base58)

    const expectedBase58TreeNode =
      '37uc7x9LVzJqsPB9un28SJEPbSop8NGHXHQjZCe6GKAX'
    const treeNode = MerkleTreeNode.treeNodeFromHash(hash)
    expect(treeNode.base58).toEqual(expectedBase58TreeNode)
  })
})
