import { type CommonQueryMethods, type DatabasePool, sql } from 'slonik'

import type { BondType, ValidatorState } from './types'
import type { LoggerWrapper } from '@marinade.finance/ts-common'

export async function loadPreviousState(
  pool: DatabasePool,
  bondType: BondType,
  logger: LoggerWrapper,
): Promise<Map<string, ValidatorState>> {
  const result = await pool.query(sql.unsafe`
    SELECT
      vote_account,
      bond_pubkey,
      bond_type,
      epoch,
      in_auction,
      bond_good_for_n_epochs,
      cap_constraint,
      cap_marinade_stake_sol,
      funded_amount_lamports,
      effective_amount_lamports,
      auction_stake_lamports,
      deficit_lamports,
      sam_eligible,
      updated_at
    FROM bond_event_state
    WHERE bond_type = ${bondType}
  `)

  interface StateRow {
    vote_account: string
    bond_pubkey: string | null
    bond_type: string
    epoch: number
    in_auction: boolean
    bond_good_for_n_epochs: number | null
    cap_constraint: string | null
    cap_marinade_stake_sol: number | null
    funded_amount_lamports: string
    effective_amount_lamports: string
    auction_stake_lamports: string
    deficit_lamports: string
    sam_eligible: boolean
    updated_at: string
  }

  const stateMap = new Map<string, ValidatorState>()
  for (const row of result.rows as unknown as StateRow[]) {
    const state: ValidatorState = {
      vote_account: row.vote_account,
      bond_pubkey: row.bond_pubkey,
      bond_type: row.bond_type as BondType,
      epoch: row.epoch,
      in_auction: row.in_auction,
      bond_good_for_n_epochs: row.bond_good_for_n_epochs,
      cap_constraint: row.cap_constraint,
      cap_marinade_stake_sol: row.cap_marinade_stake_sol,
      funded_amount_lamports: BigInt(row.funded_amount_lamports ?? '0'),
      effective_amount_lamports: BigInt(row.effective_amount_lamports ?? '0'),
      auction_stake_lamports: BigInt(row.auction_stake_lamports ?? '0'),
      deficit_lamports: BigInt(row.deficit_lamports ?? '0'),
      sam_eligible: row.sam_eligible,
      updated_at: String(row.updated_at),
    }
    stateMap.set(state.vote_account, state)
  }

  logger.info(
    `Loaded previous state: ${stateMap.size} validators for bond_type=${bondType}`,
  )
  return stateMap
}

export async function saveCurrentState(
  db: CommonQueryMethods,
  states: ValidatorState[],
  logger: LoggerWrapper,
): Promise<void> {
  if (states.length === 0) {
    logger.info('No state to save')
    return
  }

  const valueTuples = states.map(
    state => sql.fragment`(
      ${state.vote_account},
      ${state.bond_pubkey},
      ${state.bond_type},
      ${state.epoch},
      ${state.in_auction},
      ${state.bond_good_for_n_epochs},
      ${state.cap_constraint},
      ${state.cap_marinade_stake_sol},
      ${state.funded_amount_lamports.toString()},
      ${state.effective_amount_lamports.toString()},
      ${state.auction_stake_lamports.toString()},
      ${state.deficit_lamports.toString()},
      ${state.sam_eligible},
      NOW()
    )`,
  )

  await db.query(sql.unsafe`
    INSERT INTO bond_event_state (
      vote_account, bond_pubkey, bond_type, epoch,
      in_auction, bond_good_for_n_epochs, cap_constraint,
      cap_marinade_stake_sol,
      funded_amount_lamports, effective_amount_lamports,
      auction_stake_lamports, deficit_lamports, sam_eligible, updated_at
    ) VALUES
      ${sql.join(valueTuples, sql.fragment`, `)}
    ON CONFLICT (vote_account, bond_type) DO UPDATE SET
      bond_pubkey = EXCLUDED.bond_pubkey,
      epoch = EXCLUDED.epoch,
      in_auction = EXCLUDED.in_auction,
      bond_good_for_n_epochs = EXCLUDED.bond_good_for_n_epochs,
      cap_constraint = EXCLUDED.cap_constraint,
      cap_marinade_stake_sol = EXCLUDED.cap_marinade_stake_sol,
      funded_amount_lamports = EXCLUDED.funded_amount_lamports,
      effective_amount_lamports = EXCLUDED.effective_amount_lamports,
      auction_stake_lamports = EXCLUDED.auction_stake_lamports,
      deficit_lamports = EXCLUDED.deficit_lamports,
      sam_eligible = EXCLUDED.sam_eligible,
      updated_at = NOW()
  `)

  logger.info(`Saved current state: ${states.length} validators`)
}

export async function deleteRemovedValidators(
  db: CommonQueryMethods,
  bondType: BondType,
  currentVoteAccounts: Set<string>,
  logger: LoggerWrapper,
): Promise<void> {
  if (currentVoteAccounts.size === 0) {
    // All validators removed - clear all state for this bond type
    await db.query(sql.unsafe`
      DELETE FROM bond_event_state WHERE bond_type = ${bondType}
    `)
    logger.info(`Deleted all state rows for bond_type=${bondType}`)
    return
  }

  const voteAccountList = [...currentVoteAccounts]
  // Delete rows for validators no longer present in the auction result
  const result = await db.query(sql.unsafe`
    DELETE FROM bond_event_state
    WHERE bond_type = ${bondType}
      AND vote_account != ALL(${sql.array(voteAccountList, 'text')})
  `)

  if (result.rowCount > 0) {
    logger.info(
      `Deleted ${result.rowCount} stale state rows for bond_type=${bondType}`,
    )
  }
}
