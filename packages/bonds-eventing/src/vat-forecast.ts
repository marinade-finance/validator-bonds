import { calculatePmpe, lamportsToSol } from '@marinade.finance/ts-common'

import { fetchJson } from './fetch-json'

import type { LoggerWrapper } from '@marinade.finance/ts-common'

interface ValidatorsResponse {
  validators: {
    vote_account: string
    activated_stake: string
    vat_eligible?: boolean | null
    vat_rejection_reason?: string | null
    epoch_stats: { epoch: number }[]
  }[]
  total_count: number
  vat_minimum_balances?: Record<string, string>
}

interface RewardsResponse {
  rewards_inflation_est: [number, number][]
}

export interface VatVerdict {
  eligible: boolean | null
  reason: string | null
}

export interface VatForecast {
  epoch: number
  inflationPmpe: number
  minVoteBalanceSol: number | null
  byVoteAccount: Map<string, VatVerdict>
}

/**
 * Reads the running-epoch SIMD-0357 verdict per validator and the network inflation per
 * 1000 SOL of stake for one epoch from validators-api.
 * @throws when either response is incomplete
 */
export async function fetchVatForecast(
  validatorsApiUrl: string,
): Promise<VatForecast> {
  const [validators, rewards] = await Promise.all([
    fetchJson<ValidatorsResponse>(
      `${validatorsApiUrl}/validators?epochs=1&limit=10000`,
    ),
    fetchJson<RewardsResponse>(`${validatorsApiUrl}/rewards?epochs=1`),
  ])
  const epoch = validators.validators[0]?.epoch_stats[0]?.epoch
  if (epoch === undefined) {
    throw new Error('validators-api returned no validators with epoch stats')
  }
  if (validators.total_count > validators.validators.length) {
    throw new Error(
      `validators-api returned ${validators.validators.length} of ${validators.total_count} validators`,
    )
  }
  const inflationSol = rewards.rewards_inflation_est[0]?.[1]
  if (inflationSol === undefined) {
    throw new Error('validators-api returned no inflation estimate')
  }
  const totalStakeSol = lamportsToSol(
    validators.validators.reduce(
      (sum, v) => sum + BigInt(v.activated_stake),
      0n,
    ),
  )
  if (totalStakeSol.isZero()) {
    throw new Error('validators-api returned zero total activated stake')
  }
  const minBalance = validators.vat_minimum_balances?.[String(epoch)]
  return {
    epoch,
    inflationPmpe: calculatePmpe(inflationSol, totalStakeSol).toNumber(),
    minVoteBalanceSol:
      minBalance === undefined ? null : lamportsToSol(minBalance).toNumber(),
    byVoteAccount: new Map(
      validators.validators.map(v => [
        v.vote_account,
        {
          eligible: v.vat_eligible ?? null,
          reason: v.vat_rejection_reason ?? null,
        },
      ]),
    ),
  }
}

/** {@link fetchVatForecast} that logs a failure and returns null, keeping stored projections. */
export async function fetchVatForecastOrNull(
  validatorsApiUrl: string,
  logger: LoggerWrapper,
): Promise<VatForecast | null> {
  try {
    return await fetchVatForecast(validatorsApiUrl)
  } catch (err) {
    logger.error({ err }, 'VAT forecast unavailable, VAT projections kept')
    return null
  }
}
