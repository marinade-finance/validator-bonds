import { CLIContext } from '@marinade.finance/cli-common'
import { NULL_LOG, setContext } from '@marinade.finance/ts-common'

import {
  parseSettlements,
  StakerPayoutClaim,
  FeeDepositClaim,
} from '../src/dtoSettlements'

beforeAll(() => {
  setContext(new CLIContext({ logger: NULL_LOG, commandName: 'test' }))
})

const SAMPLE_JSON = JSON.stringify({
  slot: 12345,
  epoch: 800,
  settlements: [
    {
      reason: 'Bidding',
      meta: { funder: 'ValidatorBond' },
      vote_account: '11111111111111111111111111111111',
      claims_count: 2,
      claims_amount: 100,
      claims: [
        {
          withdraw_authority: '11111111111111111111111111111111',
          stake_authority: '11111111111111111111111111111111',
          claim_amount: 50,
          kind: 'StakerPayout',
          active_stake: 1000,
          activating_stake: 0,
          stake_accounts: { '11111111111111111111111111111111': 1000 },
        },
        {
          withdraw_authority: '11111111111111111111111111111111',
          stake_authority: '11111111111111111111111111111111',
          claim_amount: 50,
          kind: 'FeeDeposit',
        },
      ],
    },
  ],
})

describe('parseSettlements typed-split discrimination', () => {
  it('discriminates StakerPayout and FeeDeposit by kind', async () => {
    const dto = await parseSettlements(SAMPLE_JSON)
    expect(dto.settlements).toHaveLength(1)
    const settlement = dto.settlements[0]!
    const [staker, fee] = settlement.claims
    expect(staker).toBeInstanceOf(StakerPayoutClaim)
    expect(fee).toBeInstanceOf(FeeDepositClaim)
    expect((staker as StakerPayoutClaim).active_stake).toBe(1000n)
    expect((staker as StakerPayoutClaim).stake_accounts).toEqual({
      '11111111111111111111111111111111': 1000,
    })
  })

  it('parses FeeDeposit JSON without stake fields', async () => {
    const stale = JSON.stringify({
      slot: 1,
      epoch: 1,
      settlements: [
        {
          reason: 'Bidding',
          meta: { funder: 'ValidatorBond' },
          vote_account: '11111111111111111111111111111111',
          claims_count: 1,
          claims_amount: 50,
          claims: [
            {
              withdraw_authority: '11111111111111111111111111111111',
              stake_authority: '11111111111111111111111111111111',
              claim_amount: 50,
              kind: 'FeeDeposit',
            },
          ],
        },
      ],
    })
    const dto = await parseSettlements(stale)
    const claim = dto.settlements[0]!.claims[0]
    expect(claim).toBeInstanceOf(FeeDepositClaim)
  })
})
