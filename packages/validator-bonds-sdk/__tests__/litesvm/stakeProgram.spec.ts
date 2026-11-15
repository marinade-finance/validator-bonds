import {
  Keypair,
  LAMPORTS_PER_SOL,
  StakeProgram,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js'

import { executeIx, initLiteSvmTest, warpToNextEpoch } from './litesvm'
import { getRentExemptStake } from '../../src'
import {
  delegatedStakeAccount,
  getAndCheckStakeAccount,
} from '../utils/staking'

import type { LiteSvmProvider } from './litesvm'

describe('LiteSVM runs the mainnet stake program', () => {
  let provider: LiteSvmProvider

  beforeAll(() => {
    ;({ provider } = initLiteSvmTest())
  })

  it('minimum delegation is 1 SOL', async () => {
    const getMinimumDelegation = new TransactionInstruction({
      programId: StakeProgram.programId,
      keys: [],
      data: Buffer.from([13, 0, 0, 0]),
    })
    const { returnData } = await executeIx(
      provider,
      [provider.wallet],
      getMinimumDelegation,
    )
    expect(Buffer.concat([returnData], 8).readBigUInt64LE()).toEqual(
      BigInt(LAMPORTS_PER_SOL),
    )
  })

  it('split of an inactive stake keeps the full delegated stake in both parts', async () => {
    const rentExemptStake = await getRentExemptStake(provider)
    const { stakeAccount, staker } = await delegatedStakeAccount({
      provider,
      lamports: 10 * LAMPORTS_PER_SOL,
    })
    await warpToNextEpoch(provider)
    await provider.sendIx(
      [staker],
      StakeProgram.deactivate({
        stakePubkey: stakeAccount,
        authorizedPubkey: staker.publicKey,
      }),
      SystemProgram.transfer({
        fromPubkey: provider.walletPubkey,
        toPubkey: staker.publicKey,
        lamports: LAMPORTS_PER_SOL,
      }),
    )
    await warpToNextEpoch(provider)

    const split = Keypair.generate()
    await provider.sendIx(
      [staker, split],
      StakeProgram.split(
        {
          stakePubkey: stakeAccount,
          authorizedPubkey: staker.publicKey,
          splitStakePubkey: split.publicKey,
          lamports: 4 * LAMPORTS_PER_SOL,
        },
        rentExemptStake,
      ),
    )

    const delegatedStake = BigInt(10 * LAMPORTS_PER_SOL - rentExemptStake)
    const [source] = await getAndCheckStakeAccount(provider, stakeAccount)
    const [dest] = await getAndCheckStakeAccount(provider, split.publicKey)
    expect(
      BigInt(source.Stake?.stake.delegation.stake.toString() ?? '0'),
    ).toEqual(delegatedStake)
    expect(
      BigInt(dest.Stake?.stake.delegation.stake.toString() ?? '0'),
    ).toEqual(delegatedStake)
    expect(
      (await provider.connection.getAccountInfo(stakeAccount))?.lamports,
    ).toEqual(6 * LAMPORTS_PER_SOL)
  })
})
