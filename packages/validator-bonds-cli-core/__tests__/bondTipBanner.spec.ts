import { buildBondTipBanner } from '../src/bondTipBanner'

describe('buildBondTipBanner', () => {
  it('returns null when there is no tip', () => {
    expect(buildBondTipBanner({ tipText: null, urgency: null })).toBeNull()
    expect(buildBondTipBanner({ tipText: '', urgency: 'info' })).toBeNull()
  })

  it('renders the tip text inside a banner with the auction title', () => {
    const banner = buildBondTipBanner({
      tipText: 'Top up 7 SOL to keep your stake.',
      urgency: 'warning',
    })
    expect(banner).not.toBeNull()
    expect(banner).toContain('Marinade Stake Auction')
    expect(banner).toContain('Top up 7 SOL to keep your stake.')
  })

  it('renders the raise-maxStakeWanted advice', () => {
    const banner = buildBondTipBanner({
      tipText:
        'Your bond already covers more — raise `maxStakeWanted` to gain up to +70,000 SOL stake.',
      urgency: 'info',
    })
    expect(banner).toContain('raise `maxStakeWanted`')
    expect(banner).toContain('+70,000 SOL')
  })
})
