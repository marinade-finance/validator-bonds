import { bondAddress } from '@marinade.finance/validator-bonds-sdk'
import { PublicKey } from '@solana/web3.js'

import {
  buildBondBalanceChangeEvent,
  buildSettlementAppliedEvent,
  buildValidatorDelistedEvent,
  configAddressForBondType,
  fmtSol,
  lamportsToSol,
  makeBaseEvent,
} from './evaluate-deltas'
import { computeFlatDeficit } from './run-institutional'

import type {
  BondType,
  BondsEventV1,
  BondUnderfundedChangeDetails,
  FirstSeenDetails,
  InstitutionalValidatorData,
  ValidatorState,
} from './types'
import type { LoggerWrapper } from '@marinade.finance/ts-common'

const BOND_TYPE: BondType = 'institutional'

export function evaluateInstitutionalDeltas(
  currentValidators: InstitutionalValidatorData[],
  previousState: Map<string, ValidatorState>,
  epoch: number,
  logger: LoggerWrapper,
): BondsEventV1[] {
  const events: BondsEventV1[] = []
  const seenVoteAccounts = new Set<string>()

  for (const v of currentValidators) {
    seenVoteAccounts.add(v.voteAccount)
    const prev = previousState.get(v.voteAccount)
    const { requiredLamports, deficitLamports } = computeFlatDeficit(
      v.institutionalStakeLamports,
      v.effectiveAmountLamports,
    )
    const balanceSol = lamportsToSol(v.effectiveAmountLamports)
    const requiredSol = lamportsToSol(requiredLamports)
    const deficitSol = lamportsToSol(deficitLamports)
    const stakeSol = lamportsToSol(v.institutionalStakeLamports)

    if (!prev) {
      events.push(
        makeBaseEvent(
          'first_seen',
          v.voteAccount,
          v.bondPubkey,
          epoch,
          BOND_TYPE,
          `New Select bond detected for validator ${v.voteAccount}. ` +
            `Balance: ${fmtSol(balanceSol)} SOL.`,
          {
            bond_balance_sol: balanceSol,
            in_auction: false,
            bond_good_for_n_epochs: null,
            cap_constraint: null,
            sam_eligible: false,
            auction_stake_sol: 0,
            marinade_activated_stake_sol: stakeSol,
            epoch_cost_sol: null,
            expected_max_eff_bid_pmpe: null,
            deficit_sol: deficitSol,
            required_sol: requiredSol,
          } satisfies FirstSeenDetails,
        ),
      )
      continue
    }

    if (deficitLamports !== prev.deficit_lamports) {
      const previousDeficitSol = lamportsToSol(prev.deficit_lamports)
      events.push(
        makeBaseEvent(
          'bond_underfunded_change',
          v.voteAccount,
          v.bondPubkey,
          epoch,
          BOND_TYPE,
          `Validator ${v.voteAccount} Select bond top-up needed ` +
            `${fmtSol(previousDeficitSol)} → ${fmtSol(deficitSol)} SOL ` +
            `(balance ${fmtSol(balanceSol)} SOL, required ${fmtSol(requiredSol)} SOL ` +
            `for ${fmtSol(stakeSol)} SOL institutional stake).`,
          {
            previous_epochs: null,
            current_epochs: null,
            previous_deficit_sol: previousDeficitSol,
            bond_balance_sol: balanceSol,
            marinade_activated_stake_sol: stakeSol,
            epoch_cost_sol: null,
            expected_max_eff_bid_pmpe: null,
            deficit_sol: deficitSol,
            required_sol: requiredSol,
          } satisfies BondUnderfundedChangeDetails,
        ),
      )
    }

    const balanceEvent = buildBondBalanceChangeEvent(
      v.voteAccount,
      v.bondPubkey,
      epoch,
      BOND_TYPE,
      prev,
      v.fundedAmountLamports,
      v.effectiveAmountLamports,
    )
    if (balanceEvent) events.push(balanceEvent)

    // True claims from the bonds API — a withdraw request lowers effective_amount too and must not read as a settlement
    const settlementEvent = buildSettlementAppliedEvent(
      v.voteAccount,
      v.bondPubkey,
      epoch,
      BOND_TYPE,
      v.settlementClaimsLamports,
      prev.settlement_claims_lamports ?? 0n,
      {
        bond_balance_sol: lamportsToSol(v.fundedAmountLamports),
        claimable_balance_sol: balanceSol,
        bond_good_for_n_epochs: null,
      },
    )
    if (settlementEvent) events.push(settlementEvent)
  }

  for (const [voteAccount, prev] of previousState) {
    if (
      !seenVoteAccounts.has(voteAccount) &&
      (prev.funded_amount_lamports > 0n || prev.in_auction)
    ) {
      events.push(
        buildValidatorDelistedEvent(
          voteAccount,
          prev.bond_pubkey ??
            bondAddress(
              configAddressForBondType(BOND_TYPE),
              new PublicKey(voteAccount),
            )[0].toBase58(),
          epoch,
          BOND_TYPE,
          prev,
          `Validator ${voteAccount} Select bond is no longer reported by the bonds API. ` +
            `Last known balance: ${lamportsToSol(prev.funded_amount_lamports)} SOL, ` +
            `last seen epoch: ${prev.epoch}.`,
        ),
      )
    }
  }

  logger.info(
    `Institutional delta evaluation complete: ${events.length} events from ${currentValidators.length} validators (${previousState.size} previous)`,
  )

  return events
}

export function institutionalValidatorToState(
  v: InstitutionalValidatorData,
  epoch: number,
): ValidatorState {
  return {
    vote_account: v.voteAccount,
    bond_pubkey: v.bondPubkey,
    bond_type: BOND_TYPE,
    epoch,
    in_auction: false,
    bond_good_for_n_epochs: null,
    cap_constraint: null,
    cap_marinade_stake_sol: null,
    funded_amount_lamports: v.fundedAmountLamports,
    effective_amount_lamports: v.effectiveAmountLamports,
    auction_stake_lamports: 0n,
    deficit_lamports: computeFlatDeficit(
      v.institutionalStakeLamports,
      v.effectiveAmountLamports,
    ).deficitLamports,
    settlement_claims_lamports: v.settlementClaimsLamports,
    sam_eligible: false,
    updated_at: new Date().toISOString(),
  }
}
