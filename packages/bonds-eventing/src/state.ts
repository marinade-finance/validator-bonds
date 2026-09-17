import { jsonSafe } from './calc-relay'

import type { AuctionMeta } from './calc-relay'
import type { Directory } from './directory'
import type { BondType, ValidatorState } from './types'
import type { LoggerWrapper } from '@marinade.finance/ts-common'

/** Stored shape of one validator entry: lamport amounts are decimal strings. */
interface ValidatorStateJson {
  vote_account: string
  bond_pubkey: string | null
  bond_type: BondType
  epoch: number
  in_auction: boolean
  bond_good_for_n_epochs: number | null
  cap_constraint: string | null
  cap_marinade_stake_sol: number | null
  funded_amount_lamports: string
  effective_amount_lamports: string
  auction_stake_lamports: string
  deficit_lamports: string
  settlement_claims_lamports: string | null
  sam_eligible: boolean
  updated_at: string
  auction_validator?: Record<string, unknown>
}

interface EventingDocJson {
  epoch: number
  meta?: AuctionMeta
  validators: Record<string, ValidatorStateJson>
}

export interface EventingDocument {
  epoch: number
  meta: AuctionMeta | undefined
  validators: Map<string, ValidatorState>
}

export interface PreviousState {
  validators: Map<string, ValidatorState>
  meta: AuctionMeta | undefined
  /** null when the document does not exist yet, which makes the next save a create. */
  etag: string | null
}

function statePath(bondType: BondType): string {
  return `/bonds/eventing/${bondType}`
}

function fromJson(row: ValidatorStateJson): ValidatorState {
  return {
    vote_account: row.vote_account,
    bond_pubkey: row.bond_pubkey,
    bond_type: row.bond_type,
    epoch: row.epoch,
    in_auction: row.in_auction,
    bond_good_for_n_epochs: row.bond_good_for_n_epochs,
    cap_constraint: row.cap_constraint,
    cap_marinade_stake_sol: row.cap_marinade_stake_sol,
    funded_amount_lamports: BigInt(row.funded_amount_lamports),
    effective_amount_lamports: BigInt(row.effective_amount_lamports),
    auction_stake_lamports: BigInt(row.auction_stake_lamports),
    deficit_lamports: BigInt(row.deficit_lamports),
    settlement_claims_lamports:
      row.settlement_claims_lamports === null
        ? null
        : BigInt(row.settlement_claims_lamports),
    sam_eligible: row.sam_eligible,
    updated_at: row.updated_at,
    auction_validator: row.auction_validator,
  }
}

function toJson(state: ValidatorState): ValidatorStateJson {
  return {
    vote_account: state.vote_account,
    bond_pubkey: state.bond_pubkey,
    bond_type: state.bond_type,
    epoch: state.epoch,
    in_auction: state.in_auction,
    bond_good_for_n_epochs: state.bond_good_for_n_epochs,
    cap_constraint: state.cap_constraint,
    cap_marinade_stake_sol: state.cap_marinade_stake_sol,
    funded_amount_lamports: state.funded_amount_lamports.toString(),
    effective_amount_lamports: state.effective_amount_lamports.toString(),
    auction_stake_lamports: state.auction_stake_lamports.toString(),
    deficit_lamports: state.deficit_lamports.toString(),
    settlement_claims_lamports:
      state.settlement_claims_lamports?.toString() ?? null,
    sam_eligible: state.sam_eligible,
    updated_at: state.updated_at,
    auction_validator: state.auction_validator,
  }
}

/**
 * The store answers with whatever JSON it holds. This checks the shape the
 * loader walks — an object whose `validators` is an object — and leaves each
 * row to `fromJson`, whose BigInt conversions refuse a malformed one loudly.
 */
function isEventingDocJson(body: unknown): body is EventingDocJson {
  return (
    typeof body === 'object' &&
    body !== null &&
    'validators' in body &&
    typeof body.validators === 'object' &&
    body.validators !== null
  )
}

export async function loadPreviousState(
  dir: Directory,
  bondType: BondType,
  logger: LoggerWrapper,
): Promise<PreviousState> {
  const path = statePath(bondType)
  const doc = await dir.get(path)

  if (doc === null) {
    logger.info(`No state document at ${path}, starting from an empty map`)
    return { validators: new Map(), meta: undefined, etag: null }
  }

  // A store that answers but holds nothing looks exactly like a genuine first
  // run, and evaluating against it makes every validator first_seen - one
  // notification each, fanned out to their subscribers, with no way to recall
  // them. The same refusal the institutional run already makes on an empty
  // bond list, from the other side.

  if (!isEventingDocJson(doc.body)) {
    throw new Error(`Directory document ${path} carries no validators map`)
  }

  const validators = new Map<string, ValidatorState>()
  for (const [voteAccount, row] of Object.entries(doc.body.validators)) {
    validators.set(voteAccount, fromJson(row))
  }

  logger.info(
    `Loaded previous state: ${validators.size} validators for bond_type=${bondType}`,
  )
  return { validators, meta: doc.body.meta, etag: doc.etag }
}

export async function saveState(
  dir: Directory,
  bondType: BondType,
  doc: EventingDocument,
  etag: string | null,
  logger: LoggerWrapper,
): Promise<void> {
  const validators: Record<string, ValidatorStateJson> = {}
  for (const [voteAccount, state] of doc.validators) {
    validators[voteAccount] = toJson(state)
  }

  const body: EventingDocJson = {
    epoch: doc.epoch,
    validators,
  }
  if (doc.meta !== undefined) {
    body.meta = jsonSafe(doc.meta)
  }

  await dir.put(
    statePath(bondType),
    body,
    etag === null ? { create: true } : { ifMatch: etag },
  )

  logger.info(
    `Saved state: ${doc.validators.size} validators for bond_type=${bondType}, epoch=${doc.epoch}`,
  )
}
