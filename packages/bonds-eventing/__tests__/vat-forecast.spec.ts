import { fetchVatForecast } from '../src/vat-forecast'

const SOL = 1_000_000_000n

function validator(
  voteAccount: string,
  stakeSol: bigint,
  vat: { vat_eligible?: boolean | null; vat_rejection_reason?: string | null },
) {
  return {
    vote_account: voteAccount,
    activated_stake: (stakeSol * SOL).toString(),
    epoch_stats: [{ epoch: 1097 }],
    ...vat,
  }
}

const VALIDATORS = {
  validators: [
    validator('ok', 300_000n, {
      vat_eligible: true,
      vat_rejection_reason: null,
    }),
    validator('low', 100_000n, {
      vat_eligible: false,
      vat_rejection_reason: 'low_balance',
    }),
    validator('unknown', 0n, {}),
  ],
  total_count: 3,
  vat_minimum_balances: { '1097': '819761200' },
}

const REWARDS = { rewards_inflation_est: [[1096, 60]] }

function mockFetch(validators: unknown, rewards: unknown) {
  const calls: string[] = []
  global.fetch = jest.fn((url: string) => {
    calls.push(url)
    const body = url.includes('/rewards') ? rewards : validators
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    } as Response)
  }) as unknown as typeof fetch
  return calls
}

describe('fetchVatForecast', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('reads every validator and the running epoch verdicts', async () => {
    const calls = mockFetch(VALIDATORS, REWARDS)
    const forecast = await fetchVatForecast('https://validators.test')
    expect(calls.sort()).toEqual([
      'https://validators.test/rewards?epochs=1',
      'https://validators.test/validators?epochs=1&limit=10000',
    ])
    expect(forecast.epoch).toBe(1097)
    expect(forecast.byVoteAccount.get('ok')).toEqual({
      eligible: true,
      reason: null,
    })
    expect(forecast.byVoteAccount.get('low')).toEqual({
      eligible: false,
      reason: 'low_balance',
    })
    expect(forecast.byVoteAccount.get('unknown')).toEqual({
      eligible: null,
      reason: null,
    })
    expect(forecast.minVoteBalanceSol).toBeCloseTo(0.8197612, 9)
  })

  it('inflation PMPE is network inflation per 1000 SOL of stake', async () => {
    mockFetch(VALIDATORS, REWARDS)
    const forecast = await fetchVatForecast('https://validators.test')
    // 60 SOL over 400 000 SOL of stake
    expect(forecast.inflationPmpe).toBeCloseTo(0.15, 12)
  })

  it.each([
    [
      'no validators',
      { validators: [], total_count: 0 },
      REWARDS,
      'no validators',
    ],
    [
      'a truncated list',
      { ...VALIDATORS, total_count: 4 },
      REWARDS,
      'returned 3 of 4',
    ],
    [
      'no inflation row',
      VALIDATORS,
      { rewards_inflation_est: [] },
      'no inflation estimate',
    ],
    [
      'zero total stake',
      {
        validators: [validator('zero', 0n, {})],
        total_count: 1,
      },
      REWARDS,
      'zero total activated stake',
    ],
  ])('throws on %s', async (_name, validators, rewards, message) => {
    mockFetch(validators, rewards)
    await expect(fetchVatForecast('https://validators.test')).rejects.toThrow(
      message,
    )
  })
})
