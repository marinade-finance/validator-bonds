import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  findStakeAccount,
  StakeAccountParsed,
  ProgramAccountInfo,
} from '../../src'
import { initTest } from './testValidator'
import { ExtendedProvider } from '../utils/provider'
import {
  createInitializedStakeAccount,
  createDelegatedStakeAccount,
  createVoteAccount,
} from '../utils/staking'

describe('Find stake account', () => {
  let provider: ExtendedProvider

  beforeAll(async () => {
    ;({ provider } = await initTest())
  })

  it('find stake account', async () => {
    const staker1 = Keypair.generate().publicKey
    const staker2 = Keypair.generate().publicKey
    const withdrawer1 = Keypair.generate().publicKey
    const withdrawer2 = Keypair.generate().publicKey
    const { voteAccount } = await createVoteAccount({ provider })

    const { stakeAccount: initialized1 } = await createInitializedStakeAccount({
      provider,
      staker: staker1,
      withdrawer: withdrawer1,
    })
    const { stakeAccount: initialized2 } = await createInitializedStakeAccount({
      provider,
      staker: staker1,
      withdrawer: withdrawer2,
    })
    const delegated1 = await createDelegatedStakeAccount({
      provider,
      staker: staker1,
      withdrawer: withdrawer2,
      voteAccount,
      lamports: LAMPORTS_PER_SOL * 20,
    })
    const delegated2 = await createDelegatedStakeAccount({
      provider,
      staker: staker2,
      withdrawer: withdrawer2,
      voteAccount,
      lamports: LAMPORTS_PER_SOL * 19,
    })

    const stakeAccounts1 = await findStakeAccount({
      connection: provider,
      staker: staker1,
    })
    expect(stakeAccounts1.length).toBe(3)
    expect(includesPubkey(stakeAccounts1, initialized1)).toBeTruthy()
    expect(includesPubkey(stakeAccounts1, initialized2)).toBeTruthy()
    expect(includesPubkey(stakeAccounts1, delegated1)).toBeTruthy()

    const stakeAccounts2 = await findStakeAccount({
      connection: provider,
      staker: staker2,
    })
    expect(stakeAccounts2.length).toBe(1)
    expect(includesPubkey(stakeAccounts2, delegated2)).toBeTruthy()

    const stakeAccounts3 = await findStakeAccount({
      connection: provider,
      withdrawer: withdrawer1,
    })
    expect(stakeAccounts3.length).toBe(1)
    expect(includesPubkey(stakeAccounts3, initialized1)).toBeTruthy()

    const stakeAccounts4 = await findStakeAccount({
      connection: provider,
      withdrawer: withdrawer2,
      staker: staker1,
    })
    expect(stakeAccounts4.length).toBe(2)
    expect(includesPubkey(stakeAccounts4, initialized2)).toBeTruthy()
    expect(includesPubkey(stakeAccounts4, delegated1)).toBeTruthy()

    const stakeAccounts5 = await findStakeAccount({
      connection: provider,
      voter: voteAccount,
    })
    expect(stakeAccounts5.length).toBe(2)
    expect(includesPubkey(stakeAccounts5, delegated1)).toBeTruthy()
    expect(includesPubkey(stakeAccounts5, delegated2)).toBeTruthy()

    const stakeAccounts6 = await findStakeAccount({
      connection: provider,
      voter: voteAccount,
      staker: staker2,
    })
    expect(stakeAccounts6.length).toBe(1)
    expect(includesPubkey(stakeAccounts6, delegated2)).toBeTruthy()
  })

  function includesPubkey(
    arr: ProgramAccountInfo<StakeAccountParsed>[],
    pubkey: PublicKey
  ): boolean {
    return arr.map(r => r.publicKey.toBase58()).includes(pubkey.toBase58())
  }
})
