import { type AuctionValidator } from '@marinade.finance/ds-sam-sdk'
import {
  bondAddress,
  MARINADE_CONFIG_ADDRESS,
  MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
} from '@marinade.finance/validator-bonds-sdk'
import { PublicKey } from '@solana/web3.js'

import type { BondType, BondsEventV1, ValidatorState } from './types'
import type { LoggerWrapper } from '@marinade.finance/ts-common'

const LAMPORTS_PER_SOL = 1_000_000_000

function solToLamports(sol: number | null | undefined): bigint {
  if (sol === null || sol === undefined || !isFinite(sol)) return 0n
  return BigInt(Math.round(sol * LAMPORTS_PER_SOL))
}

function lamportsToSol(lamports: bigint): number {
  return Number(lamports) / LAMPORTS_PER_SOL
}

/**
 * Round bondGoodForNEpochs to 2 decimal places to avoid float jitter.
 * The SDK computes this as a division (bondBalanceForBids / epochCostSol)
 * which can produce slightly different floats between runs even when
 * the underlying values haven't meaningfully changed.
 */
function roundEpochs(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !isFinite(value)) return null
  return Math.round(value * 100) / 100
}

export function configAddressForBondType(bondType: BondType): PublicKey {
  switch (bondType) {
    case 'bidding':
      return MARINADE_CONFIG_ADDRESS
    case 'institutional':
      return MARINADE_INSTITUTIONAL_CONFIG_ADDRESS
    default: {
      const _exhaustive: never = bondType
      throw new Error(`Unknown bond type: ${String(_exhaustive)}`)
    }
  }
}

function isInAuction(v: AuctionValidator): boolean {
  return (v.auctionStake?.marinadeSamTargetSol ?? 0) > 0
}

function getCapConstraint(v: AuctionValidator): string | null {
  return v.lastCapConstraint?.constraintType ?? null
}

/**
 * Compute bond deficit metrics: how much more SOL is needed for 1 full epoch of bid coverage.
 */
function computeDeficitMetrics(v: AuctionValidator): {
  epoch_cost_sol: number | null
  expected_max_eff_bid_pmpe: number | null
  deficit_sol: number | null
  required_sol: number | null
} {
  const pmpe = v.revShare?.expectedMaxEffBidPmpe
  const onchainPmpe = v.revShare?.onchainDistributedPmpe
  if (pmpe === undefined || pmpe === null || !v.marinadeActivatedStakeSol) {
    return {
      epoch_cost_sol: null,
      expected_max_eff_bid_pmpe: null,
      deficit_sol: null,
      required_sol: null,
    }
  }

  const epochCostSol = (pmpe / 1000) * v.marinadeActivatedStakeSol
  const protectedStakeSol = Math.max(
    0,
    v.marinadeActivatedStakeSol - (v.unprotectedStakeSol ?? 0),
  )
  const onchainCostSol =
    onchainPmpe !== undefined && onchainPmpe !== null
      ? (onchainPmpe / 1000) * protectedStakeSol
      : 0

  // Required for 1 epoch of bid coverage + on-chain obligations
  const requiredSol = onchainCostSol + epochCostSol
  const bondBalance = v.bondBalanceSol ?? 0
  const deficitSol = Math.max(0, requiredSol - bondBalance)

  return {
    epoch_cost_sol: epochCostSol,
    expected_max_eff_bid_pmpe: pmpe,
    deficit_sol: deficitSol,
    required_sol: requiredSol,
  }
}

function makeBaseEvent(
  innerType: BondsEventV1['inner_type'],
  voteAccount: string,
  bondPubkey: string,
  epoch: number,
  bondType: BondType,
  message: string,
  details: Record<string, unknown>,
): BondsEventV1 {
  return {
    type: 'bonds',
    inner_type: innerType,
    vote_account: voteAccount,
    bond_pubkey: bondPubkey,
    bond_type: bondType,
    epoch,
    data: { message, details },
    created_at: new Date().toISOString(),
  }
}

function makeEvent(
  innerType: BondsEventV1['inner_type'],
  v: AuctionValidator,
  epoch: number,
  bondType: BondType,
  configAddress: PublicKey,
  message: string,
  details: Record<string, unknown>,
): BondsEventV1 {
  return makeBaseEvent(
    innerType,
    v.voteAccount,
    bondAddress(configAddress, new PublicKey(v.voteAccount))[0].toBase58(),
    epoch,
    bondType,
    message,
    details,
  )
}

export function evaluateDeltas(
  currentValidators: AuctionValidator[],
  previousState: Map<string, ValidatorState>,
  epoch: number,
  bondType: BondType,
  logger: LoggerWrapper,
): BondsEventV1[] {
  const configAddress = configAddressForBondType(bondType)
  const events: BondsEventV1[] = []
  const seenVoteAccounts = new Set<string>()

  for (const v of currentValidators) {
    seenVoteAccounts.add(v.voteAccount)
    const prev = previousState.get(v.voteAccount)
    const currentInAuction = isInAuction(v)
    const currentCap = getCapConstraint(v)
    const currentFundedLamports = solToLamports(v.bondBalanceSol)
    const currentEffectiveLamports = solToLamports(
      v.claimableBondBalanceSol ?? v.bondBalanceSol,
    )
    if (!prev) {
      // First seen - new validator/bond
      const deficitMetrics = computeDeficitMetrics(v)
      const event = makeEvent(
        'first_seen',
        v,
        epoch,
        bondType,
        configAddress,
        `New bond detected for validator ${v.voteAccount}. ` +
          `Balance: ${v.bondBalanceSol ?? 0} SOL, ` +
          `in auction: ${currentInAuction}, ` +
          `bondGoodForNEpochs: ${v.bondGoodForNEpochs == null || !isFinite(v.bondGoodForNEpochs) ? 'N/A' : v.bondGoodForNEpochs}.`,
        {
          bond_balance_sol: v.bondBalanceSol,
          in_auction: currentInAuction,
          bond_good_for_n_epochs: roundEpochs(v.bondGoodForNEpochs),
          cap_constraint: currentCap,
          sam_eligible: v.samEligible,
          auction_stake_sol: v.auctionStake?.marinadeSamTargetSol ?? 0,
          marinade_activated_stake_sol: v.marinadeActivatedStakeSol,
          ...deficitMetrics,
        },
      )
      events.push(event)
      continue
    }

    // Auction status changes
    if (!prev.in_auction && currentInAuction) {
      events.push(
        makeEvent(
          'auction_entered',
          v,
          epoch,
          bondType,
          configAddress,
          `Validator ${v.voteAccount} entered the auction. ` +
            `Target stake: ${v.auctionStake?.marinadeSamTargetSol ?? 0} SOL.`,
          {
            previous_in_auction: false,
            current_in_auction: true,
            auction_stake_sol: v.auctionStake?.marinadeSamTargetSol ?? 0,
            bond_good_for_n_epochs: roundEpochs(v.bondGoodForNEpochs),
          },
        ),
      )
    } else if (prev.in_auction && !currentInAuction) {
      events.push(
        makeEvent(
          'auction_exited',
          v,
          epoch,
          bondType,
          configAddress,
          `Validator ${v.voteAccount} exited the auction.`,
          {
            previous_in_auction: true,
            current_in_auction: false,
            previous_auction_stake_lamports:
              prev.auction_stake_lamports.toString(),
            sam_eligible: v.samEligible,
          },
        ),
      )
    }

    // Cap constraint changes
    if (prev.cap_constraint !== currentCap) {
      events.push(
        makeEvent(
          'cap_changed',
          v,
          epoch,
          bondType,
          configAddress,
          `Validator ${v.voteAccount} cap constraint changed ` +
            `from ${prev.cap_constraint ?? 'none'} to ${currentCap ?? 'none'}.`,
          {
            previous_cap: prev.cap_constraint,
            current_cap: currentCap,
            constraint_name: v.lastCapConstraint?.constraintName ?? null,
          },
        ),
      )
    }

    // Bond good for N epochs change (rounded to avoid float jitter)
    // OR deficit changed (any lamport-level difference).
    const currentEpochsRounded = roundEpochs(v.bondGoodForNEpochs)
    const currentDeficitSol = computeDeficitMetrics(v).deficit_sol
    const currentDeficitLamports = solToLamports(currentDeficitSol)
    const epochsChanged =
      prev.bond_good_for_n_epochs !== null &&
      currentEpochsRounded !== null &&
      prev.bond_good_for_n_epochs !== currentEpochsRounded
    const epochsNewlyKnown =
      prev.bond_good_for_n_epochs === null && currentEpochsRounded !== null
    // Skip deficit comparison when current deficit is unknown (null)
    // to avoid conflating "unknown" with "zero"
    const deficitChanged =
      currentDeficitSol !== null &&
      currentDeficitLamports !== prev.deficit_lamports

    if (epochsChanged || epochsNewlyKnown || deficitChanged) {
      const deficitMetrics = computeDeficitMetrics(v)
      const message = epochsNewlyKnown
        ? `Validator ${v.voteAccount} bond coverage is now ${currentEpochsRounded} epochs (was unknown).`
        : epochsChanged
          ? `Validator ${v.voteAccount} bond coverage changed ` +
            `from ${prev.bond_good_for_n_epochs} to ${currentEpochsRounded} epochs.`
          : `Validator ${v.voteAccount} bond deficit changed ` +
            `from ${lamportsToSol(prev.deficit_lamports)} to ${lamportsToSol(currentDeficitLamports)} SOL.`
      events.push(
        makeEvent(
          'bond_underfunded_change',
          v,
          epoch,
          bondType,
          configAddress,
          message,
          {
            previous_epochs: prev.bond_good_for_n_epochs,
            current_epochs: currentEpochsRounded,
            bond_balance_sol: v.bondBalanceSol,
            marinade_activated_stake_sol: v.marinadeActivatedStakeSol,
            ...deficitMetrics,
          },
        ),
      )
    }

    // Balance changes (lamport-level precision)
    if (currentFundedLamports !== prev.funded_amount_lamports) {
      const deltaLamports = currentFundedLamports - prev.funded_amount_lamports
      events.push(
        makeEvent(
          'bond_balance_change',
          v,
          epoch,
          bondType,
          configAddress,
          `Validator ${v.voteAccount} bond balance changed by ` +
            `${deltaLamports > 0n ? '+' : ''}${lamportsToSol(deltaLamports)} SOL ` +
            `(${lamportsToSol(prev.funded_amount_lamports)} → ${lamportsToSol(currentFundedLamports)} SOL).`,
          {
            previous_funded_lamports: prev.funded_amount_lamports.toString(),
            current_funded_lamports: currentFundedLamports.toString(),
            delta_lamports: deltaLamports.toString(),
            previous_effective_lamports:
              prev.effective_amount_lamports.toString(),
            current_effective_lamports: currentEffectiveLamports.toString(),
          },
        ),
      )
    }

    // SAM eligibility changes
    if (prev.sam_eligible !== v.samEligible) {
      events.push(
        makeEvent(
          'sam_eligible_change',
          v,
          epoch,
          bondType,
          configAddress,
          `Validator ${v.voteAccount} SAM eligibility changed ` +
            `from ${prev.sam_eligible} to ${v.samEligible}.`,
          {
            previous_sam_eligible: prev.sam_eligible,
            current_sam_eligible: v.samEligible,
          },
        ),
      )
    }
  }

  // Check for removed validators
  for (const [voteAccount, prev] of previousState) {
    if (!seenVoteAccounts.has(voteAccount)) {
      events.push(
        makeBaseEvent(
          'bond_removed',
          voteAccount,
          prev.bond_pubkey ??
            bondAddress(
              configAddress,
              new PublicKey(voteAccount),
            )[0].toBase58(),
          epoch,
          bondType,
          `Bond removed for validator ${voteAccount}.`,
          {
            last_known_funded_lamports: prev.funded_amount_lamports.toString(),
            last_known_epoch: prev.epoch,
            last_known_in_auction: prev.in_auction,
          },
        ),
      )
    }
  }

  logger.info(
    `Delta evaluation complete: ${events.length} events from ${currentValidators.length} validators (${previousState.size} previous)`,
  )

  return events
}

export function validatorToState(
  v: AuctionValidator,
  epoch: number,
  bondType: BondType,
): ValidatorState {
  const configAddress = configAddressForBondType(bondType)
  return {
    vote_account: v.voteAccount,
    bond_pubkey: bondAddress(
      configAddress,
      new PublicKey(v.voteAccount),
    )[0].toBase58(),
    bond_type: bondType,
    epoch,
    in_auction: isInAuction(v),
    bond_good_for_n_epochs: roundEpochs(v.bondGoodForNEpochs),
    cap_constraint: getCapConstraint(v),
    funded_amount_lamports: solToLamports(v.bondBalanceSol),
    effective_amount_lamports: solToLamports(
      v.claimableBondBalanceSol ?? v.bondBalanceSol,
    ),
    auction_stake_lamports: solToLamports(v.auctionStake?.marinadeSamTargetSol),
    deficit_lamports: solToLamports(computeDeficitMetrics(v).deficit_sol),
    sam_eligible: v.samEligible,
    updated_at: new Date().toISOString(),
  }
}
