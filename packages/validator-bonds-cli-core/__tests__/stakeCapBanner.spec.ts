import { LAMPORTS_PER_SOL } from '@solana/web3.js'

import { buildBondCapBanner } from '../src/stakeCapBanner'

const SOL = LAMPORTS_PER_SOL

describe('buildBondCapBanner', () => {
  const base = {
    maxStakeWantedLamports: 250_000 * SOL,
    targetStakeLamports: 180_000 * SOL,
    bondBalanceLamports: 18 * SOL,
    requiredBalanceLamports: 18 * SOL,
    capConstraint: 'BOND',
  }

  it('returns null when the binding cap is not the bond', () => {
    expect(buildBondCapBanner({ ...base, capConstraint: 'COUNTRY' })).toBeNull()
    expect(buildBondCapBanner({ ...base, capConstraint: null })).toBeNull()
  })

  it('returns null when maxStakeWanted does not exceed the target', () => {
    expect(
      buildBondCapBanner({
        ...base,
        maxStakeWantedLamports: 180_000 * SOL,
      }),
    ).toBeNull()
    expect(
      buildBondCapBanner({
        ...base,
        maxStakeWantedLamports: 100_000 * SOL,
      }),
    ).toBeNull()
  })

  it('returns null when target or balance is non-positive', () => {
    expect(buildBondCapBanner({ ...base, targetStakeLamports: 0 })).toBeNull()
    expect(buildBondCapBanner({ ...base, bondBalanceLamports: 0 })).toBeNull()
  })

  it('renders the banner with X, Y and Z derived from the leverage', () => {
    const banner = buildBondCapBanner(base)
    expect(banner).not.toBeNull()
    // leverage = 180000/18 = 10000 stake SOL per bond SOL
    // X = 250000 - 180000 = 70,000 SOL additional stake
    // Y = 70000 / 10000 = 7 SOL additional bond
    // Z = requiredBalance = 18 SOL
    expect(banner).toContain('250,000.00 SOL')
    expect(banner).toContain('180,000.00 SOL')
    expect(banner).toContain('7.00 SOL')
    expect(banner).toContain('+70,000.00 SOL')
    expect(banner).toContain('18.00 SOL')
  })

  it('falls back to the current balance for Z when required is unknown', () => {
    const banner = buildBondCapBanner({
      ...base,
      requiredBalanceLamports: null,
    })
    expect(banner).toContain('>= 18.00 SOL')
  })
})
