import {
  MARINADE_CONFIG_ADDRESS,
  MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
} from '@marinade.finance/validator-bonds-sdk'
import { Keypair } from '@solana/web3.js'

import { otherBondConfig } from '../src/commands/manage/subscribe'

describe('otherBondConfig', () => {
  it('points a bidding bond at the Select CLI', () => {
    const other = otherBondConfig(MARINADE_CONFIG_ADDRESS)
    expect(other).not.toBeNull()
    expect(other!.config).toEqual(MARINADE_INSTITUTIONAL_CONFIG_ADDRESS)
    expect(other!.label).toBe('Marinade Select')
    expect(other!.cli).toBe('validator-bonds-institutional')
  })

  it('points a Select bond at the bidding CLI', () => {
    const other = otherBondConfig(MARINADE_INSTITUTIONAL_CONFIG_ADDRESS)
    expect(other).not.toBeNull()
    expect(other!.config).toEqual(MARINADE_CONFIG_ADDRESS)
    expect(other!.label).toBe('bidding')
    expect(other!.cli).toBe('validator-bonds')
  })

  it('has no counterpart for a custom config', () => {
    expect(otherBondConfig(Keypair.generate().publicKey)).toBeNull()
  })
})
