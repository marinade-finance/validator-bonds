import pino from 'pino'

import { runInstitutional } from '../src/run-institutional'

import type { EventingConfig } from '../src/types'

const logger = pino({ level: 'silent' })

const config = {
  bondsApiUrl: 'https://bonds.test',
  institutionalApiUrl: 'https://institutional.test',
} as EventingConfig

function mockFetchResponses(
  bonds: unknown,
  stakes: unknown,
  ok: boolean = true,
) {
  return jest.fn((url: string) => {
    const body = url.includes('/bonds/institutional') ? bonds : stakes
    return Promise.resolve({
      ok,
      status: ok ? 200 : 500,
      json: () => Promise.resolve(body),
    } as Response)
  })
}

describe('runInstitutional', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  const stakeRows = [
    {
      vote_account: 'vote1',
      epoch: 993,
      institutional_active_lamports: '30000000000000',
      institutional_activating_lamports: '2000000000000',
    },
  ]

  it('joins bonds with institutional stake by vote account', async () => {
    global.fetch = mockFetchResponses(
      {
        bonds: [
          {
            pubkey: 'bond1',
            vote_account: 'vote1',
            epoch: 990,
            funded_amount: 10_000_000_000,
            effective_amount: 8_000_000_000,
            remainining_settlement_claim_amount: 1_000_000_000,
          },
          {
            pubkey: 'bond2',
            vote_account: 'vote2',
            epoch: 991,
            funded_amount: 5_000_000_000,
            effective_amount: 5_000_000_000,
            remainining_settlement_claim_amount: 0,
          },
        ],
      },
      stakeRows,
    ) as unknown as typeof fetch

    const { validators, epoch } = await runInstitutional(config, logger)

    expect(epoch).toBe(993)
    expect(validators).toHaveLength(2)
    expect(validators[0]).toEqual({
      voteAccount: 'vote1',
      bondPubkey: 'bond1',
      fundedAmountLamports: 10_000_000_000n,
      effectiveAmountLamports: 8_000_000_000n,
      settlementClaimsLamports: 1_000_000_000n,
      institutionalStakeLamports: 32_000_000_000_000n,
    })
    // bond without stake row gets zero institutional stake
    expect(validators[1]!.institutionalStakeLamports).toBe(0n)
  })

  it('throws when the bonds list is empty', async () => {
    global.fetch = mockFetchResponses(
      { bonds: [] },
      stakeRows,
    ) as unknown as typeof fetch

    await expect(runInstitutional(config, logger)).rejects.toThrow(
      'no institutional bonds',
    )
  })

  it('throws when the stake list is empty', async () => {
    global.fetch = mockFetchResponses(
      {
        bonds: [
          {
            pubkey: 'bond1',
            vote_account: 'vote1',
            epoch: 990,
            funded_amount: 1,
            effective_amount: 1,
            remainining_settlement_claim_amount: 0,
          },
        ],
      },
      [],
    ) as unknown as typeof fetch

    await expect(runInstitutional(config, logger)).rejects.toThrow('no rows')
  })

  it('throws on HTTP error', async () => {
    global.fetch = mockFetchResponses(
      { bonds: [] },
      [],
      false,
    ) as unknown as typeof fetch

    await expect(runInstitutional(config, logger)).rejects.toThrow('HTTP 500')
  })
})
