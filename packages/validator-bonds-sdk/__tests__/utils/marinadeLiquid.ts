import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'

import {
  MARINADE_LIQUID_PROGRAM_ID,
  MARINADE_LIQUID_STATE,
  MARINADE_LIQUID_STATE_STAKE_LIST_OFFSET,
} from '../../src'

import type { BankrunExtendedProvider } from '@marinade.finance/bankrun-utils'

export const MARINADE_LIQUID_STAKE_LIST = new PublicKey(
  'Anv3XE7e5saNdm16MU6bniYS59Mpv7DzQXHAhxJUmAKW',
)
export const STAKE_LIST_DISCRIMINATOR = 'staker__'
const STATE_SIZE = 2616
const ITEM_SIZE = 56

export function buildMarinadeLiquidState({
  stakeList,
  count,
  itemSize = ITEM_SIZE,
}: {
  stakeList: PublicKey
  count: number
  itemSize?: number
}): Buffer {
  const data = Buffer.alloc(STATE_SIZE)
  stakeList.toBuffer().copy(data, MARINADE_LIQUID_STATE_STAKE_LIST_OFFSET)
  data.writeUInt32LE(itemSize, MARINADE_LIQUID_STATE_STAKE_LIST_OFFSET + 32)
  data.writeUInt32LE(count, MARINADE_LIQUID_STATE_STAKE_LIST_OFFSET + 36)
  return data
}

/**
 * Builds stake list data with `records` at their indexes and unique filler records up to `fillTo`.
 */
export function buildMarinadeLiquidStakeList({
  records,
  fillTo = records.length,
  capacity = Math.max(fillTo, records.length),
  discriminator = STAKE_LIST_DISCRIMINATOR,
}: {
  records: (PublicKey | undefined)[]
  fillTo?: number
  capacity?: number
  discriminator?: string
}): Buffer {
  const data = Buffer.alloc(8 + capacity * ITEM_SIZE)
  data.write(discriminator, 0, 'latin1')
  for (let i = 0; i < fillTo; i++) {
    const offset = 8 + i * ITEM_SIZE
    const record = records[i]
    if (record !== undefined) {
      record.toBuffer().copy(data, offset)
    } else {
      data.fill(0xff, offset, offset + 32)
      data.writeUInt32LE(i, offset)
    }
  }
  return data
}

export function injectMarinadeLiquidAccounts(
  provider: BankrunExtendedProvider,
  {
    stateData,
    stakeListData,
    stakeList = MARINADE_LIQUID_STAKE_LIST,
    stateOwner = MARINADE_LIQUID_PROGRAM_ID,
    stakeListOwner = MARINADE_LIQUID_PROGRAM_ID,
  }: {
    stateData: Buffer
    stakeListData: Buffer
    stakeList?: PublicKey
    stateOwner?: PublicKey
    stakeListOwner?: PublicKey
  },
) {
  provider.context.setAccount(MARINADE_LIQUID_STATE, {
    lamports: LAMPORTS_PER_SOL,
    data: stateData,
    owner: stateOwner,
    executable: false,
  })
  provider.context.setAccount(stakeList, {
    lamports: 4 * LAMPORTS_PER_SOL,
    data: stakeListData,
    owner: stakeListOwner,
    executable: false,
  })
}

/**
 * Injects a valid liquid State and stake list where `listed[i]` sits at index `i` of `count` live records.
 */
export function injectValidMarinadeLiquidAccounts(
  provider: BankrunExtendedProvider,
  {
    listed,
    count = listed.length,
    capacity,
  }: {
    listed: (PublicKey | undefined)[]
    count?: number
    capacity?: number
  },
) {
  injectMarinadeLiquidAccounts(provider, {
    stateData: buildMarinadeLiquidState({
      stakeList: MARINADE_LIQUID_STAKE_LIST,
      count,
    }),
    stakeListData: buildMarinadeLiquidStakeList({
      records: listed,
      fillTo: Math.max(count, listed.length),
      capacity,
    }),
  })
}
