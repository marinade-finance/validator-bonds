export type {
  BondsEventV1,
  BondsEventInnerType,
  FirstSeenDetails,
  BondRemovedDetails,
  AuctionEnteredDetails,
  AuctionExitedDetails,
  CapChangedDetails,
  BondUnderfundedChangeDetails,
  BondBalanceChangeDetails,
  SamEligibleChangeDetails,
  AnnouncementDetails,
  VersionBumpDetails,
} from '@marinade.finance/notifications-bonds-event-v1'
import type { BondsEventV1 } from '@marinade.finance/notifications-bonds-event-v1'

export type BondType = BondsEventV1['bond_type']

export interface ValidatorState {
  vote_account: string
  bond_pubkey: string | null
  bond_type: BondType
  epoch: number
  in_auction: boolean
  bond_good_for_n_epochs: number | null
  cap_constraint: string | null
  funded_amount_lamports: bigint
  effective_amount_lamports: bigint
  auction_stake_lamports: bigint
  deficit_lamports: bigint
  sam_eligible: boolean
  updated_at: string
}

export interface EmitResult {
  status: 'sent' | 'failed'
  messageId: string
  error?: string
}

export interface EventingConfig {
  bondsApiUrl: string
  validatorsApiUrl: string
  scoringApiUrl: string
  tvlApiUrl: string
  notificationsApiUrl: string | undefined
  notificationsJwt: string | undefined
  postgresUrl: string | undefined
  postgresSslRootCert: string | undefined
  retryMaxAttempts: number
  retryBaseDelayMs: number
  emitConcurrency: number
  dryRun: boolean
  cacheInputs: string | undefined
}
