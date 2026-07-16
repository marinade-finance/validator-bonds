import type { EventingConfig, InstitutionalValidatorData } from './types'
import type { LoggerWrapper } from '@marinade.finance/ts-common'

// Mirrors ALLOWED_STAKE_PER_BOND_RATIO in institutional-staking check-bonds.ts
export const ALLOWED_STAKE_PER_BOND_RATIO = 2000n

export function computeFlatDeficit(
  stakeLamports: bigint,
  effectiveLamports: bigint,
): { requiredLamports: bigint; deficitLamports: bigint } {
  const requiredLamports = stakeLamports / ALLOWED_STAKE_PER_BOND_RATIO
  const deficitLamports =
    requiredLamports > effectiveLamports
      ? requiredLamports - effectiveLamports
      : 0n
  return { requiredLamports, deficitLamports }
}

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
  const { bonds } = await fetchJson<BondsResponse>(
    `${config.bondsApiUrl}/bonds/institutional`,
  )
  const stakes = await fetchJson<InstitutionalValidatorRow[]>(
    `${config.institutionalApiUrl}/v1/validators/latest`,
  )

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
    fundedAmountLamports: BigInt(bond.funded_amount),
    effectiveAmountLamports: BigInt(bond.effective_amount),
    settlementClaimsLamports: BigInt(bond.remainining_settlement_claim_amount),
    institutionalStakeLamports: stakeByVoteAccount.get(bond.vote_account) ?? 0n,
  }))

  logger.info(
    `Institutional data loaded: ${validators.length} bonds, ${stakes.length} staked validators, epoch ${epoch}`,
  )

  return { validators, epoch }
}
