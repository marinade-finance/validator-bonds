export type {
  BondsEventV1,
  BondsEventInnerType,
  FirstSeenDetails,
  ValidatorDelistedDetails,
  AuctionEnteredDetails,
  AuctionExitedDetails,
  CapChangedDetails,
  BondUnderfundedChangeDetails,
  BondBalanceChangeDetails,
  SamEligibleChangeDetails,
  SettlementAppliedDetails,
  PenaltyExpectedDetails,
  PenaltyProjectedDetails,
  AnnouncementDetails,
  VersionBumpDetails,
} from '@marinade.finance/notifications-bonds-event-v1'
import type {
  BondsEventV1,
  PenaltyProjectedDetails,
} from '@marinade.finance/notifications-bonds-event-v1'

export type BondType = BondsEventV1['bond_type']

export type PenaltyType = PenaltyProjectedDetails['penalty_type']

export interface ProjectedPenaltiesState {
  for_epoch: number
  types: Partial<Record<PenaltyType, { projected_sol: number }>>
}

export type ExpectedPenaltyKind =
  'bid_too_low' | 'blacklist' | 'bond_risk_fee' | 'activating_stake_fee'

export interface ExpectedPenaltiesState {
  epoch: number
  kinds: ExpectedPenaltyKind[]
}

export interface InstitutionalValidatorData {
  voteAccount: string
  bondPubkey: string
  fundedAmountLamports: bigint
  effectiveAmountLamports: bigint
  settlementClaimsLamports: bigint
  institutionalStakeLamports: bigint
}

export interface ValidatorState {
  vote_account: string
  bond_pubkey: string | null
  bond_type: BondType
  epoch: number
  in_auction: boolean
  bond_good_for_n_epochs: number | null
  cap_constraint: string | null
  cap_marinade_stake_sol: number | null
  funded_amount_lamports: bigint
  effective_amount_lamports: bigint
  auction_stake_lamports: bigint
  deficit_lamports: bigint
  // Remaining settlement claims (bonds API); null = unknown (bidding rows)
  settlement_claims_lamports: bigint | null
  sam_eligible: boolean
  updated_at: string
  projected_penalties: ProjectedPenaltiesState | null
  expected_penalties: ExpectedPenaltiesState | null
  // Calc blob relayed to the CLI; set only on save (validatorToState), not loaded
  // back — it is not part of the delta comparison.
  auction_validator?: Record<string, unknown>
}

export type PostResult =
  | { kind: 'sent' }
  | { kind: 'rejected'; error: string }
  | { kind: 'unauthorized'; error: string }
  | { kind: 'unavailable'; error: string }
  | { kind: 'retryable'; error: string }

export interface PendingEvent {
  id: number
  messageId: string
  payload: BondsEventV1
  attempts: number
  supersededByNewer: boolean
}

export interface SendSummary {
  sent: number
  rejected: number
  failed: number
  remaining: number
  stoppedBy: 'unauthorized' | 'unavailable' | 'retryable' | null
  lastError: string | null
}

export interface EventingConfig {
  bondsApiUrl: string
  validatorsApiUrl: string
  scoringApiUrl: string
  tvlApiUrl: string
  institutionalApiUrl: string
  postgresUrl: string | undefined
  postgresSslRootCert: string | undefined
  dryRun: boolean
  cacheInputs: string | undefined
}

export interface SendConfig {
  notificationsApiUrl: string | undefined
  notificationsJwt: string | undefined
  postgresUrl: string
  postgresSslRootCert: string | undefined
  retryMaxAttempts: number
  retryBaseDelayMs: number
  dryRun: boolean
  summaryFile: string | undefined
}
