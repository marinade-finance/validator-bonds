import { type AuctionValidator } from '@marinade.finance/ds-sam-sdk'
import {
  bondAddress,
  MARINADE_CONFIG_ADDRESS,
  MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
} from '@marinade.finance/validator-bonds-sdk'
import { PublicKey } from '@solana/web3.js'

import type {
  BondType,
  BondsEventV1,
  ValidatorState,
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
} from './types'
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
 * Coerce a possibly-non-finite number to a fallback. The DS SAM SDK
 * initializes several validator aggregate fields to `NaN` (see
 * `validatorAggDefaults()` in ds-sam-sdk) and only fills them in for
 * eligible validators. `value ?? 0` does NOT catch NaN, so any NaN that
 * leaks into an event payload makes slonik's `sql.jsonb` throw
 * `JSON payload cannot be stringified.` (safe-stable-stringify strict mode).
 */
function finiteOr(value: number | null | undefined, fallback: number): number {
  return value == null || !isFinite(value) ? fallback : value
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
      const exhaustiveCheck: never = bondType
      throw new Error(`Unknown bond type: ${String(exhaustiveCheck)}`)
    }
  }
}

function isInAuction(v: AuctionValidator): boolean {
  return (v.auctionStake?.marinadeSamTargetSol ?? 0) > 0
}

/**
 * Build the user-facing message for a penalty_expected event from the
 * four possible charge components. Terminology:
 *  - bid_too_low / blacklist   → "penalty" (punishment for validator behavior)
 *  - bond_risk_fee             → "fee"     (cost of carrying risk)
 *  - activating_stake_fee      → "fee"     (separate from bond-side total)
 * Single bond-side component   → dedicated one-liner, no redundant total.
 * Multiple bond-side components → "charges totaling X SOL … : a, b, c.".
 * Activating-stake fee present → separate trailing sentence.
 */
function buildPenaltyExpectedMessage(
  voteAccount: string,
  penalties: {
    total: number
    bidTooLow: number
    blacklist: number
    bondRiskFee: number
  },
  activatingStakeFee: number,
): string {
  const components: string[] = []
  if (penalties.bidTooLow > 0) {
    components.push(`bid-too-low penalty ${penalties.bidTooLow.toFixed(4)} SOL`)
  }
  if (penalties.blacklist > 0) {
    components.push(`blacklist penalty ${penalties.blacklist.toFixed(4)} SOL`)
  }
  if (penalties.bondRiskFee > 0) {
    components.push(`bond risk fee ${penalties.bondRiskFee.toFixed(4)} SOL`)
  }

  let bondSideSentence: string | null = null
  if (components.length === 1) {
    bondSideSentence = `Validator ${voteAccount} is predicted to incur a ${components[0]} this epoch.`
  } else if (components.length >= 2) {
    bondSideSentence =
      `Validator ${voteAccount} is predicted to incur charges totaling ${penalties.total.toFixed(4)} SOL this epoch: ` +
      `${components.join(', ')}.`
  }

  if (activatingStakeFee > 0) {
    const feeSentence =
      bondSideSentence !== null
        ? `In addition, an activating-stake fee of ${activatingStakeFee.toFixed(4)} SOL will be charged (separate from bond penalties).`
        : `Validator ${voteAccount} is predicted to be charged an activating-stake fee of ${activatingStakeFee.toFixed(4)} SOL this epoch (separate from bond penalties).`
    return bondSideSentence !== null
      ? `${bondSideSentence} ${feeSentence}`
      : feeSentence
  }

  // emit condition guarantees at least one of the components > 0
  return bondSideSentence ?? ''
}

function getCapConstraint(v: AuctionValidator): string | null {
  return v.lastCapConstraint?.constraintType ?? null
}

function getCapMarinadeStakeSol(v: AuctionValidator): number | null {
  return v.lastCapConstraint?.marinadeStakeSol ?? null
}

const VALID_CAP_TYPES = new Set([
  'COUNTRY',
  'ASO',
  'VALIDATOR',
  'BOND',
  'WANT',
  'RISK',
])

function asCapType(
  value: string | null,
): CapChangedDetails['current_cap_type'] {
  if (value === null) return null
  return VALID_CAP_TYPES.has(value)
    ? (value as NonNullable<CapChangedDetails['current_cap_type']>)
    : null
}

/**
 * Compute expected penalties from DS SAM auction fields.
 * These are known at auction time, before on-chain settlement.
 *
 * Formula: `pmpe / 1000 * stake` — matches the settlement pipeline
 * (sam_penalties.rs) which uses the same conversion. Note: this differs
 * from `v.values.paidUndelegationSol` which uses `/ winningTotalPmpe`
 * and computes *undelegation amounts*, not *penalty claims*.
 */
function computePenalties(v: AuctionValidator): {
  total: number
  bidTooLow: number
  blacklist: number
  bondRiskFee: number
} {
  const stake = finiteOr(v.marinadeActivatedStakeSol, 0)
  const bidTooLow =
    (finiteOr(v.revShare?.bidTooLowPenaltyPmpe, 0) / 1000) * stake
  const blacklist =
    (finiteOr(v.revShare?.blacklistPenaltyPmpe, 0) / 1000) * stake
  const bondRiskFee = finiteOr(v.values?.bondRiskFeeSol, 0)
  return {
    total: bidTooLow + blacklist + bondRiskFee,
    bidTooLow,
    blacklist,
    bondRiskFee,
  }
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
  const stake = v.marinadeActivatedStakeSol
  if (pmpe == null || !isFinite(pmpe) || !stake || !isFinite(stake)) {
    return {
      epoch_cost_sol: null,
      expected_max_eff_bid_pmpe: null,
      deficit_sol: null,
      required_sol: null,
    }
  }

  const epochCostSol = (pmpe / 1000) * stake
  const protectedStakeSol = Math.max(
    0,
    stake - finiteOr(v.unprotectedStakeSol, 0),
  )
  const onchainCostSol =
    onchainPmpe != null && isFinite(onchainPmpe)
      ? (onchainPmpe / 1000) * protectedStakeSol
      : 0

  // Required for 1 epoch of bid coverage + on-chain obligations
  const requiredSol = onchainCostSol + epochCostSol
  const bondBalance = finiteOr(v.bondBalanceSol, 0)
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
  details: BondsEventV1['data']['details'],
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
  details: BondsEventV1['data']['details'],
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
        } satisfies FirstSeenDetails,
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
          } satisfies AuctionEnteredDetails,
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
          } satisfies AuctionExitedDetails,
        ),
      )
    }

    // Cap constraint changes
    if (prev.cap_constraint !== currentCap) {
      const currentCapSol = getCapMarinadeStakeSol(v)
      const bondBalanceSol = v.bondBalanceSol ?? null
      const prevBondBalanceSol = lamportsToSol(prev.funded_amount_lamports)
      const bondBalanceDeltaSol =
        bondBalanceSol !== null ? bondBalanceSol - prevBondBalanceSol : null
      const coverageMetrics = computeDeficitMetrics(v)
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
            previous_cap_type: asCapType(prev.cap_constraint),
            current_cap_type: asCapType(currentCap),
            previous_cap_sol: prev.cap_marinade_stake_sol,
            current_cap_sol: currentCapSol,
            total_left_to_cap_sol:
              v.lastCapConstraint?.totalLeftToCapSol ?? null,
            bond_balance_sol: bondBalanceSol,
            bond_balance_delta_sol: bondBalanceDeltaSol,
            required_coverage_sol: coverageMetrics.epoch_cost_sol,
          } satisfies CapChangedDetails,
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
          } satisfies BondUnderfundedChangeDetails,
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
          } satisfies BondBalanceChangeDetails,
        ),
      )
    }

    // Settlement detection: pending settlement = funded - effective
    const currentSettlementLamports =
      currentFundedLamports - currentEffectiveLamports
    const prevSettlementLamports =
      prev.funded_amount_lamports - prev.effective_amount_lamports
    // Only emit when settlement > 0 (active), changed, and above dust (0.01 SOL)
    const MIN_SETTLEMENT_LAMPORTS = 10_000_000n
    if (
      currentSettlementLamports > 0n &&
      currentSettlementLamports !== prevSettlementLamports &&
      currentSettlementLamports >= MIN_SETTLEMENT_LAMPORTS
    ) {
      const totalSol = lamportsToSol(currentSettlementLamports)
      const prevSol =
        prevSettlementLamports > 0n
          ? lamportsToSol(prevSettlementLamports)
          : null
      events.push(
        makeEvent(
          'settlement_applied',
          v,
          epoch,
          bondType,
          configAddress,
          `Validator ${v.voteAccount} has a pending settlement of ` +
            `${totalSol} SOL against their bond` +
            (prevSol !== null ? ` (changed from ${prevSol} SOL).` : '.') +
            ` Claimable balance: ${v.claimableBondBalanceSol ?? v.bondBalanceSol} SOL.`,
          {
            settlement_total_sol: totalSol,
            previous_settlement_sol: prevSol,
            bond_balance_sol: v.bondBalanceSol,
            claimable_balance_sol:
              v.claimableBondBalanceSol ?? v.bondBalanceSol,
            bond_good_for_n_epochs: roundEpochs(v.bondGoodForNEpochs),
          } satisfies SettlementAppliedDetails,
        ),
      )
    }

    // Penalty prediction from auction simulation
    // Only emit on epoch change to avoid flooding the queue every run.
    // Brain dedup (per vote_account + epoch + renotify window) is the safety net.
    const penalties = computePenalties(v)
    // Fee on newly activating stake: charged separately from total_penalty_sol.
    // activating_stake_sol = max(0, SAM target - already activated); pairs with revShare.activatingStakePmpe.
    const activatingStakeSol = Math.max(
      0,
      finiteOr(v.auctionStake?.marinadeSamTargetSol, 0) -
        finiteOr(v.marinadeActivatedStakeSol, 0),
    )
    const activatingStakePmpe = finiteOr(v.revShare?.activatingStakePmpe, 0)
    const activatingStakeFee = (activatingStakeSol * activatingStakePmpe) / 1000
    // Shared dust threshold: aligns the emit gate with displayed/emitted
    // values so a sub-dust fee never surfaces as "0.0000 SOL".
    const DUST_SOL_THRESHOLD = 0.001
    const activatingStakeFeeDisplay =
      activatingStakeFee > DUST_SOL_THRESHOLD ? activatingStakeFee : 0
    // Emit when EITHER a bond-side penalty/fee OR an activating-stake fee is
    // predicted. Activating-stake fee is charged separately from the bond-side
    // total but still represents a real cost the validator should see.
    if (
      (penalties.total > DUST_SOL_THRESHOLD ||
        activatingStakeFee > DUST_SOL_THRESHOLD) &&
      prev.epoch !== epoch
    ) {
      events.push(
        makeEvent(
          'penalty_expected',
          v,
          epoch,
          bondType,
          configAddress,
          buildPenaltyExpectedMessage(
            v.voteAccount,
            penalties,
            activatingStakeFeeDisplay,
          ),
          {
            total_penalty_sol: penalties.total,
            bid_too_low_penalty_sol: penalties.bidTooLow,
            blacklist_penalty_sol: penalties.blacklist,
            bond_risk_fee_sol: penalties.bondRiskFee,
            bid_too_low_penalty_pmpe: v.revShare.bidTooLowPenaltyPmpe,
            blacklist_penalty_pmpe: v.revShare.blacklistPenaltyPmpe,
            marinade_activated_stake_sol: v.marinadeActivatedStakeSol,
            bond_balance_sol: v.bondBalanceSol,
            bond_good_for_n_epochs: roundEpochs(v.bondGoodForNEpochs),
            activating_stake_sol: activatingStakeSol,
            activating_stake_pmpe: activatingStakePmpe,
            activating_stake_fee_sol: activatingStakeFeeDisplay,
          } satisfies PenaltyExpectedDetails,
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
          } satisfies SamEligibleChangeDetails,
        ),
      )
    }
  }

  // Validator was in previous SAM auction data but is no longer returned
  // (e.g., delinquent, scoring change). Does NOT mean a bond was closed on-chain.
  // Only emit for validators that actually had a funded bond or auction participation.
  for (const [voteAccount, prev] of previousState) {
    if (
      !seenVoteAccounts.has(voteAccount) &&
      (prev.funded_amount_lamports > 0n || prev.in_auction)
    ) {
      events.push(
        makeBaseEvent(
          'validator_delisted',
          voteAccount,
          prev.bond_pubkey ??
            bondAddress(
              configAddress,
              new PublicKey(voteAccount),
            )[0].toBase58(),
          epoch,
          bondType,
          `Validator ${voteAccount} is no longer present in SAM auction data. ` +
            `Last known balance: ${lamportsToSol(prev.funded_amount_lamports)} SOL, ` +
            `last seen epoch: ${prev.epoch}.`,
          {
            last_known_funded_lamports: prev.funded_amount_lamports.toString(),
            last_known_epoch: prev.epoch,
            last_known_in_auction: prev.in_auction,
            last_known_sam_eligible: prev.sam_eligible,
          } satisfies ValidatorDelistedDetails,
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
    cap_marinade_stake_sol: getCapMarinadeStakeSol(v),
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
