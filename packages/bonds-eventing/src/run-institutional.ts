import type { EventingConfig, InstitutionalValidatorData } from './types'
import type { LoggerWrapper } from '@marinade.finance/ts-common'

interface BondsResponse {
  bonds: {
    pubkey: string
    vote_account: string
    epoch: number
    funded_amount: number
    effective_amount: number
    remainining_settlement_claim_amount: number
  }[]
}

interface InstitutionalValidatorRow {
  vote_account: string
  epoch: number
  institutional_active_lamports: string
  institutional_activating_lamports: string
}

// bonds API serializes lamport amounts as f64 (api/src/dto.rs), not as integers
function toLamports(value: number): bigint {
  return BigInt(Math.trunc(value))
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) {
    throw new Error(`GET ${url} failed: HTTP ${response.status}`)
  }
  return (await response.json()) as T
}

export async function runInstitutional(
  config: EventingConfig,
  logger: LoggerWrapper,
): Promise<{ validators: InstitutionalValidatorData[]; epoch: number }> {
  const [{ bonds }, stakes] = await Promise.all([
    fetchJson<BondsResponse>(`${config.bondsApiUrl}/bonds/institutional`),
    fetchJson<InstitutionalValidatorRow[]>(
      `${config.institutionalApiUrl}/v1/validators/latest`,
    ),
  ])

  if (bonds.length === 0) {
    throw new Error(
      'Bonds API returned no institutional bonds — refusing to evaluate (would delist all tracked validators)',
    )
  }
  const firstStake = stakes[0]
  if (!firstStake) {
    throw new Error(
      'Institutional validators API returned no rows — refusing to evaluate (would zero all deficits)',
    )
  }

  const stakeByVoteAccount = new Map<string, bigint>()
  for (const row of stakes) {
    stakeByVoteAccount.set(
      row.vote_account,
      BigInt(row.institutional_active_lamports) +
        BigInt(row.institutional_activating_lamports),
    )
  }

  // /latest rows share the last processed epoch; bonds' own epochs vary per update
  const epoch = firstStake.epoch

  const validators = bonds.map(bond => ({
    voteAccount: bond.vote_account,
    bondPubkey: bond.pubkey,
    fundedAmountLamports: toLamports(bond.funded_amount),
    effectiveAmountLamports: toLamports(bond.effective_amount),
    settlementClaimsLamports: toLamports(
      bond.remainining_settlement_claim_amount,
    ),
    institutionalStakeLamports: stakeByVoteAccount.get(bond.vote_account) ?? 0n,
  }))

  logger.info(
    `Institutional data loaded: ${validators.length} bonds, ${stakes.length} staked validators, epoch ${epoch}`,
  )

  return { validators, epoch }
}
