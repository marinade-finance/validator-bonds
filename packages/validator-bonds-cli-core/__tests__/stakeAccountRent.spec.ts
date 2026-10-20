import {
  STAKE_ACCOUNT_PSEUDO_RENT_EXEMPT_RESERVE,
  minimalSizeStakeAccount,
} from '@marinade.finance/validator-bonds-sdk'
import BN from 'bn.js'

const MIN_STAKE = new BN(1_000_000_000)
// SIMD-0437 step 1, live on mainnet since 2026-09-03; step 2 drops it to 1_666_240
const LIVE_RENT_STEP_1 = 2_077_224

describe('stake account rent floors', () => {
  it('mirrors the program floor and ignores the reduced live rent', () => {
    expect(minimalSizeStakeAccount(MIN_STAKE).toString()).toEqual('1002282880')
    expect(STAKE_ACCOUNT_PSEUDO_RENT_EXEMPT_RESERVE).toBeGreaterThan(
      LIVE_RENT_STEP_1,
    )
  })

  it('rejects a withdraw amount that the live rent alone would accept', () => {
    const acceptedByLiveRent = MIN_STAKE.addn(LIVE_RENT_STEP_1)
    expect(acceptedByLiveRent.lt(minimalSizeStakeAccount(MIN_STAKE))).toBe(true)
  })

  it('funding floor covers both the program mirror and the live rent', () => {
    for (const liveRent of [LIVE_RENT_STEP_1, 1_666_240, 228_288, 9_999_999]) {
      const floor = BN.max(
        minimalSizeStakeAccount(MIN_STAKE),
        MIN_STAKE.addn(liveRent),
      )
      expect(floor.gte(minimalSizeStakeAccount(MIN_STAKE))).toBe(true)
      expect(floor.gte(MIN_STAKE.addn(liveRent))).toBe(true)
    }
  })
})
