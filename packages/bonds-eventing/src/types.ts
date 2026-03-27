export interface BondsEventV1 {
  type: 'bonds'
  inner_type: BondsEventInnerType
  vote_account: string
  bond_pubkey: string | null
  bond_type: string
  epoch: number
  data: {
    message: string
    details: Record<string, unknown>
  }
  created_at: string // ISO 8601
}

export type BondsEventInnerType =
  | 'first_seen'
  | 'bond_removed'
  | 'auction_entered'
  | 'auction_exited'
  | 'cap_changed'
  | 'bond_underfunded_change'
  | 'bond_balance_change'
  | 'announcement'
  | 'version_bump'
  | 'sam_eligible_change'

export interface ValidatorState {
  vote_account: string
  bond_pubkey: string | null
  bond_type: string
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
