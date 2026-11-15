import { getVoteAccountFromData } from '@marinade.finance/web3js-1x'
import {
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  VoteProgram,
} from '@solana/web3.js'

import { initLiteSvmTest } from './litesvm'
import { VOTE_ACCOUNT_SIZE } from '../../src'
import {
  createVoteAccount,
  delegatedStakeAccount,
  getAndCheckStakeAccount,
  setVoteAccountVariant,
} from '../utils/staking'

import type { LiteSvmProvider } from './litesvm'
import type { VoteAccountVariant } from '../utils/staking'
import type { AccountInfo } from '@solana/web3.js'

describe('Vote account variants', () => {
  let provider: LiteSvmProvider

  beforeAll(() => {
    ;({ provider } = initLiteSvmTest())
  })

  async function variantOf(variant: VoteAccountVariant) {
    const voteKeypair = Keypair.generate()
    const authorizedWithdrawer = Keypair.generate()
    await createVoteAccount({
      provider,
      voteAccount: voteKeypair,
      authorizedWithdrawer,
    })
    const { stakeAccount } = await delegatedStakeAccount({
      provider,
      voteAccountToDelegate: voteKeypair.publicKey,
      lamports: 2 * LAMPORTS_PER_SOL,
    })
    await setVoteAccountVariant({
      provider,
      voteAccount: voteKeypair,
      authorizedWithdrawer,
      variant,
    })
    const info = await provider.connection.getAccountInfo(voteKeypair.publicKey)
    return { votePubkey: voteKeypair.publicKey, stakeAccount, info }
  }

  it('closed: the address is gone', async () => {
    const { info } = await variantOf('closed')
    expect(info).toBeNull()
  })

  it('dusted: system-owned without data', async () => {
    const { info } = await variantOf('dusted')
    expect(info?.owner.equals(SystemProgram.programId)).toBe(true)
    expect(info?.data.length).toEqual(0)
  })

  it('zeroed: vote-owned with zero-filled data', async () => {
    const { info } = await variantOf('zeroed')
    expect(info?.owner.equals(VoteProgram.programId)).toBe(true)
    expect(info?.data.length).toEqual(VOTE_ACCOUNT_SIZE)
    expect(info?.data.every(b => b === 0)).toBe(true)
  })

  it('foreign: re-created under another owner', async () => {
    const { info } = await variantOf('foreign')
    expect(info).not.toBeNull()
    expect(info?.owner.equals(VoteProgram.programId)).toBe(false)
    expect(info?.owner.equals(SystemProgram.programId)).toBe(false)
    expect(info?.data.length).toEqual(8)
  })

  it.each<VoteAccountVariant>(['live', 'reopened', 'reopenedZeroed'])(
    '%s: an initialized vote account',
    async variant => {
      const { votePubkey, info } = await variantOf(variant)
      expect(info?.owner.equals(VoteProgram.programId)).toBe(true)
      expect(info?.data.length).toEqual(VOTE_ACCOUNT_SIZE)
      expect(info?.data.readUInt32LE(0)).not.toEqual(0)
      expect(
        getVoteAccountFromData(votePubkey, info as AccountInfo<Buffer>).account
          .data.nodePubkey,
      ).toBeDefined()
    },
  )

  it.each<VoteAccountVariant>([
    'closed',
    'dusted',
    'zeroed',
    'foreign',
    'reopened',
    'reopenedZeroed',
  ])('%s: the stake delegation keeps the vote address', async variant => {
    const { votePubkey, stakeAccount } = await variantOf(variant)
    const [state] = await getAndCheckStakeAccount(provider, stakeAccount)
    expect(state.Stake?.stake.delegation.voterPubkey.equals(votePubkey)).toBe(
      true,
    )
  })
})
