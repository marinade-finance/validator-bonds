import { bondAddress } from '@marinade.finance/validator-bonds-sdk'
import { PublicKey } from '@solana/web3.js'
import pino from 'pino'

import {
  evaluateDeltas,
  validatorToState,
  configAddressForBondType,
} from '../src/evaluate-deltas'

import type { ValidatorState } from '../src/types'
import type {
  FirstSeenDetails,
  ValidatorDelistedDetails,
  AuctionEnteredDetails,
  AuctionExitedDetails,
  CapChangedDetails,
  BondUnderfundedChangeDetails,
  BondBalanceChangeDetails,
  SettlementAppliedDetails,
  PenaltyExpectedDetails,
} from '../src/types'
import type { AuctionValidator } from '@marinade.finance/ds-sam-sdk'

const logger = pino({ level: 'silent' })

// Use a deterministic valid pubkey for tests
const TEST_VOTE_ACCOUNT = '11111111111111111111111111111112'

function makeValidator(overrides: Record<string, unknown> = {}) {
  return {
    voteAccount: TEST_VOTE_ACCOUNT,
    bondBalanceSol: 10.0,
    claimableBondBalanceSol: 10.0,
    marinadeActivatedStakeSol: 50000,
    bondGoodForNEpochs: 5,
    samEligible: true,
    backstopEligible: false,
    samBlocked: false,
    lastCapConstraint: null,
    auctionStake: { marinadeSamTargetSol: 1000, externalActivatedSol: 0 },
    revShare: {
      expectedMaxEffBidPmpe: 3.2,
      onchainDistributedPmpe: 0.5,
    },
    stakePriority: 1,
    unstakePriority: 1,
    maxBondDelegation: 10000,
    bondSamStakeCapSol: 10000,
    unprotectedStakeCapSol: 0,
    unprotectedStakeSol: 0,
    bondSamHealth: 1,
    clientVersion: '2.0.0',
    voteCredits: 1000,
    aso: 'Hetzner',
    country: 'DE',
    lastBondBalanceSol: 10.0,
    totalActivatedStakeSol: 60000,
    lastMarinadeActivatedStakeSol: 50000,
    lastSamBlacklisted: false,
    inflationCommissionDec: 0.05,
    mevCommissionDec: 0.05,
    blockRewardsCommissionDec: null,
    bidCpmpe: 3.0,
    maxStakeWanted: null,
    foundationStakeSol: 0,
    selfStakeSol: 100,
    epochStats: [],
    auctions: [],
    values: {},
    bidTooLowPenalty: {},
    bondForcedUndelegation: {},
    ...overrides,
  } as unknown as AuctionValidator
}

function expectedBondPubkey(): string {
  const configAddress = configAddressForBondType('bidding')
  const [pubkey] = bondAddress(configAddress, new PublicKey(TEST_VOTE_ACCOUNT))
  return pubkey.toBase58()
}

function makePrevState(
  overrides: Partial<ValidatorState> = {},
): ValidatorState {
  return {
    vote_account: TEST_VOTE_ACCOUNT,
    bond_pubkey: expectedBondPubkey(),
    bond_type: 'bidding',
    epoch: 929,
    in_auction: true,
    bond_good_for_n_epochs: 5,
    cap_constraint: null,
    cap_marinade_stake_sol: null,
    funded_amount_lamports: 10_000_000_000n,
    effective_amount_lamports: 10_000_000_000n,
    auction_stake_lamports: 1_000_000_000_000n,
    deficit_lamports: 175_000_000_000n, // requiredSol(185) - bondBalance(10) = 175 SOL
    sam_eligible: true,
    updated_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('evaluateDeltas', () => {
  it('emits first_seen for new validator', () => {
    const validators = [makeValidator()]
    const previousState = new Map<string, ValidatorState>()

    const events = evaluateDeltas(
      validators,
      previousState,
      930,
      'bidding',
      logger,
    )

    expect(events).toHaveLength(1)
    expect(events[0]!.inner_type).toBe('first_seen')
    expect(events[0]!.vote_account).toBe(TEST_VOTE_ACCOUNT)
    expect(events[0]!.type).toBe('bonds')
    expect(events[0]!.data.message).toContain('New bond detected')
    expect(events[0]!.bond_pubkey).toBe(expectedBondPubkey())
    expect(events[0]!.bond_type).toBe('bidding')
    expect(events[0]!.created_at).toBeDefined()
    // Deficit metrics included in first_seen
    const firstSeenDetails = events[0]!.data.details as FirstSeenDetails
    expect(firstSeenDetails.expected_max_eff_bid_pmpe).toBe(3.2)
    expect(firstSeenDetails.epoch_cost_sol).toBeCloseTo(160) // (3.2/1000)*50000
    expect(firstSeenDetails.deficit_sol).toBeDefined()
    expect(firstSeenDetails.required_sol).toBeDefined()
  })

  it('emits validator_delisted for missing funded validator', () => {
    const validators: AuctionValidator[] = []
    const previousState = new Map<string, ValidatorState>()
    previousState.set(TEST_VOTE_ACCOUNT, makePrevState())

    const events = evaluateDeltas(
      validators,
      previousState,
      930,
      'bidding',
      logger,
    )

    expect(events).toHaveLength(1)
    expect(events[0]!.inner_type).toBe('validator_delisted')
    expect(events[0]!.vote_account).toBe(TEST_VOTE_ACCOUNT)
    expect(events[0]!.bond_pubkey).toBe(expectedBondPubkey())
    expect(events[0]!.data.message).toContain('no longer present in SAM')
    const details = events[0]!.data.details as ValidatorDelistedDetails
    expect(details.last_known_funded_lamports).toBe('10000000000')
    expect(details.last_known_epoch).toBe(929)
    expect(details.last_known_in_auction).toBe(true)
    expect(details.last_known_sam_eligible).toBe(true)
  })

  it('does not emit validator_delisted for zero-balance non-auction validator', () => {
    const validators: AuctionValidator[] = []
    const previousState = new Map<string, ValidatorState>()
    previousState.set(
      TEST_VOTE_ACCOUNT,
      makePrevState({
        funded_amount_lamports: 0n,
        effective_amount_lamports: 0n,
        in_auction: false,
        auction_stake_lamports: 0n,
      }),
    )

    const events = evaluateDeltas(
      validators,
      previousState,
      930,
      'bidding',
      logger,
    )

    expect(events).toHaveLength(0)
  })

  it('emits validator_delisted for zero-balance validator that was in auction', () => {
    const validators: AuctionValidator[] = []
    const previousState = new Map<string, ValidatorState>()
    previousState.set(
      TEST_VOTE_ACCOUNT,
      makePrevState({
        funded_amount_lamports: 0n,
        in_auction: true,
      }),
    )

    const events = evaluateDeltas(
      validators,
      previousState,
      930,
      'bidding',
      logger,
    )

    expect(events).toHaveLength(1)
    expect(events[0]!.inner_type).toBe('validator_delisted')
    const details = events[0]!.data.details as ValidatorDelistedDetails
    expect(details.last_known_funded_lamports).toBe('0')
    expect(details.last_known_in_auction).toBe(true)
    expect(details.last_known_sam_eligible).toBe(true)
  })

  it('emits auction_entered when validator joins auction', () => {
    const validators = [makeValidator()]
    const previousState = new Map<string, ValidatorState>()
    previousState.set(TEST_VOTE_ACCOUNT, makePrevState({ in_auction: false }))

    const events = evaluateDeltas(
      validators,
      previousState,
      930,
      'bidding',
      logger,
    )

    const entered = events.find(e => e.inner_type === 'auction_entered')
    expect(entered).toBeDefined()
    const enteredDetails = entered!.data.details as AuctionEnteredDetails
    expect(enteredDetails.previous_in_auction).toBe(false)
    expect(enteredDetails.current_in_auction).toBe(true)
  })

  it('emits auction_exited when validator leaves auction', () => {
    const validators = [
      makeValidator({
        auctionStake: { marinadeSamTargetSol: 0, externalActivatedSol: 0 },
      }),
    ]
    const previousState = new Map<string, ValidatorState>()
    previousState.set(TEST_VOTE_ACCOUNT, makePrevState({ in_auction: true }))

    const events = evaluateDeltas(
      validators,
      previousState,
      930,
      'bidding',
      logger,
    )

    const exited = events.find(e => e.inner_type === 'auction_exited')
    expect(exited).toBeDefined()
    const exitedDetails = exited!.data.details as AuctionExitedDetails
    expect(exitedDetails.previous_in_auction).toBe(true)
    expect(exitedDetails.current_in_auction).toBe(false)
  })

  it('emits cap_changed when constraint changes', () => {
    const validators = [
      makeValidator({
        lastCapConstraint: {
          constraintType: 'BOND',
          constraintName: 'bond_cap',
        },
      }),
    ]
    const previousState = new Map<string, ValidatorState>()
    previousState.set(
      TEST_VOTE_ACCOUNT,
      makePrevState({ cap_constraint: null }),
    )

    const events = evaluateDeltas(
      validators,
      previousState,
      930,
      'bidding',
      logger,
    )

    const capChanged = events.find(e => e.inner_type === 'cap_changed')
    expect(capChanged).toBeDefined()
    const capDetails = capChanged!.data.details as CapChangedDetails
    expect(capDetails.previous_cap).toBeNull()
    expect(capDetails.current_cap).toBe('BOND')
  })

  it('emits cap_changed with numeric context and driver data', () => {
    const validators = [
      makeValidator({
        bondBalanceSol: 4.0,
        lastCapConstraint: {
          constraintType: 'BOND',
          constraintName: 'bond_cap',
          marinadeStakeSol: 5_867,
          totalLeftToCapSol: 1_000,
        },
      }),
    ]
    const previousState = new Map<string, ValidatorState>()
    previousState.set(
      TEST_VOTE_ACCOUNT,
      makePrevState({
        cap_constraint: 'ASO',
        cap_marinade_stake_sol: 12_345,
        funded_amount_lamports: 10_000_000_000n, // 10 SOL
      }),
    )

    const events = evaluateDeltas(
      validators,
      previousState,
      930,
      'bidding',
      logger,
    )

    const capChanged = events.find(e => e.inner_type === 'cap_changed')
    const d = capChanged!.data.details as CapChangedDetails
    expect(d.previous_cap_type).toBe('ASO')
    expect(d.current_cap_type).toBe('BOND')
    expect(d.previous_cap_sol).toBe(12_345)
    expect(d.current_cap_sol).toBe(5_867)
    expect(d.total_left_to_cap_sol).toBe(1_000)
    expect(d.bond_balance_sol).toBe(4.0)
    expect(d.bond_balance_delta_sol).toBe(-6.0)
    expect(d.required_coverage_sol).not.toBeNull()
  })

  it('emits bond_underfunded_change when epochs change', () => {
    const validators = [makeValidator({ bondGoodForNEpochs: 2 })]
    const previousState = new Map<string, ValidatorState>()
    previousState.set(
      TEST_VOTE_ACCOUNT,
      makePrevState({ bond_good_for_n_epochs: 5 }),
    )

    const events = evaluateDeltas(
      validators,
      previousState,
      930,
      'bidding',
      logger,
    )

    const underfunded = events.find(
      e => e.inner_type === 'bond_underfunded_change',
    )
    expect(underfunded).toBeDefined()
    const underfundedDetails = underfunded!.data
      .details as BondUnderfundedChangeDetails
    expect(underfundedDetails.previous_epochs).toBe(5)
    expect(underfundedDetails.current_epochs).toBe(2)
    // Deficit metrics derived from revShare
    expect(underfundedDetails.expected_max_eff_bid_pmpe).toBe(3.2)
    expect(underfundedDetails.epoch_cost_sol).toBeCloseTo((3.2 / 1000) * 50000) // 160 SOL
    expect(underfundedDetails.deficit_sol).toBeGreaterThan(0)
    expect(underfundedDetails.required_sol).toBeGreaterThan(0)
  })

  it('emits bond_balance_change when funded amount changes', () => {
    // Previous: 10 SOL, Current: 8 SOL
    const validators = [makeValidator({ bondBalanceSol: 8.0 })]
    const previousState = new Map<string, ValidatorState>()
    previousState.set(
      TEST_VOTE_ACCOUNT,
      makePrevState({ funded_amount_lamports: 10_000_000_000n }),
    )

    const events = evaluateDeltas(
      validators,
      previousState,
      930,
      'bidding',
      logger,
    )

    const balanceChange = events.find(
      e => e.inner_type === 'bond_balance_change',
    )
    expect(balanceChange).toBeDefined()
    const balanceDetails = balanceChange!.data
      .details as BondBalanceChangeDetails
    expect(balanceDetails.delta_lamports).toBe('-2000000000')
  })

  it('suppresses bond_underfunded_change on float jitter', () => {
    // Previous: 5.00, Current: 4.999999999 — rounds to 5.00, no event
    const validators = [makeValidator({ bondGoodForNEpochs: 4.999999999 })]
    const previousState = new Map<string, ValidatorState>()
    previousState.set(
      TEST_VOTE_ACCOUNT,
      makePrevState({ bond_good_for_n_epochs: 5.0 }),
    )

    const events = evaluateDeltas(
      validators,
      previousState,
      930,
      'bidding',
      logger,
    )

    const underfunded = events.find(
      e => e.inner_type === 'bond_underfunded_change',
    )
    expect(underfunded).toBeUndefined()
  })

  it('emits bond_underfunded_change on meaningful epoch change', () => {
    // Previous: 5.00, Current: 4.98 — rounds to 4.98, different from 5.00
    const validators = [makeValidator({ bondGoodForNEpochs: 4.98 })]
    const previousState = new Map<string, ValidatorState>()
    previousState.set(
      TEST_VOTE_ACCOUNT,
      makePrevState({ bond_good_for_n_epochs: 5.0 }),
    )

    const events = evaluateDeltas(
      validators,
      previousState,
      930,
      'bidding',
      logger,
    )

    const underfunded = events.find(
      e => e.inner_type === 'bond_underfunded_change',
    )
    expect(underfunded).toBeDefined()
  })

  it('emits bond_underfunded_change on deficit change even when rounded epochs are unchanged', () => {
    // Same rounded epochs (5.00) but different deficit due to different bond balance
    // Previous: bondBalanceSol=10 -> deficit=175, Current: bondBalanceSol=5 -> deficit=180
    const validators = [makeValidator({ bondBalanceSol: 5.0 })]
    const previousState = new Map<string, ValidatorState>()
    previousState.set(
      TEST_VOTE_ACCOUNT,
      makePrevState({
        bond_good_for_n_epochs: 5.0,
        funded_amount_lamports: 10_000_000_000n,
        deficit_lamports: 175_000_000_000n,
      }),
    )

    const events = evaluateDeltas(
      validators,
      previousState,
      930,
      'bidding',
      logger,
    )

    const underfunded = events.find(
      e => e.inner_type === 'bond_underfunded_change',
    )
    expect(underfunded).toBeDefined()
    const deficitDetails = underfunded!.data
      .details as BondUnderfundedChangeDetails
    expect(deficitDetails.deficit_sol).toBeGreaterThan(175)
  })

  it('emits no events when nothing changed', () => {
    const validators = [makeValidator()]
    const previousState = new Map<string, ValidatorState>()
    previousState.set(TEST_VOTE_ACCOUNT, makePrevState())

    const events = evaluateDeltas(
      validators,
      previousState,
      930,
      'bidding',
      logger,
    )

    expect(events).toHaveLength(0)
  })

  // --- settlement_applied ---

  it('emits settlement_applied when new settlement appears', () => {
    // bondBalanceSol=10, claimableBondBalanceSol=8 => 2 SOL settlement
    const validators = [
      makeValidator({ bondBalanceSol: 10.0, claimableBondBalanceSol: 8.0 }),
    ]
    const previousState = new Map<string, ValidatorState>()
    previousState.set(TEST_VOTE_ACCOUNT, makePrevState())

    const events = evaluateDeltas(
      validators,
      previousState,
      930,
      'bidding',
      logger,
    )

    const settlement = events.find(e => e.inner_type === 'settlement_applied')
    expect(settlement).toBeDefined()
    const details = settlement!.data.details as SettlementAppliedDetails
    expect(details.settlement_total_sol).toBe(2)
    expect(details.previous_settlement_sol).toBeNull()
    expect(details.bond_balance_sol).toBe(10)
    expect(details.claimable_balance_sol).toBe(8)
  })

  it('suppresses settlement_applied below dust threshold', () => {
    // 0.005 SOL settlement < MIN_SETTLEMENT_LAMPORTS (0.01 SOL)
    const validators = [
      makeValidator({ bondBalanceSol: 10.0, claimableBondBalanceSol: 9.995 }),
    ]
    const previousState = new Map<string, ValidatorState>()
    previousState.set(TEST_VOTE_ACCOUNT, makePrevState())

    const events = evaluateDeltas(
      validators,
      previousState,
      930,
      'bidding',
      logger,
    )

    const settlement = events.find(e => e.inner_type === 'settlement_applied')
    expect(settlement).toBeUndefined()
  })

  it('suppresses settlement_applied when unchanged', () => {
    // Both prev and current have same 2 SOL settlement
    const validators = [
      makeValidator({ bondBalanceSol: 10.0, claimableBondBalanceSol: 8.0 }),
    ]
    const previousState = new Map<string, ValidatorState>()
    previousState.set(
      TEST_VOTE_ACCOUNT,
      makePrevState({
        funded_amount_lamports: 10_000_000_000n,
        effective_amount_lamports: 8_000_000_000n,
      }),
    )

    const events = evaluateDeltas(
      validators,
      previousState,
      930,
      'bidding',
      logger,
    )

    const settlement = events.find(e => e.inner_type === 'settlement_applied')
    expect(settlement).toBeUndefined()
  })

  it('includes previous_settlement_sol when settlement changes', () => {
    // Prev had 1 SOL settlement, now 3 SOL
    const validators = [
      makeValidator({ bondBalanceSol: 10.0, claimableBondBalanceSol: 7.0 }),
    ]
    const previousState = new Map<string, ValidatorState>()
    previousState.set(
      TEST_VOTE_ACCOUNT,
      makePrevState({
        funded_amount_lamports: 10_000_000_000n,
        effective_amount_lamports: 9_000_000_000n,
      }),
    )

    const events = evaluateDeltas(
      validators,
      previousState,
      930,
      'bidding',
      logger,
    )

    const settlement = events.find(e => e.inner_type === 'settlement_applied')
    expect(settlement).toBeDefined()
    const details = settlement!.data.details as SettlementAppliedDetails
    expect(details.settlement_total_sol).toBe(3)
    expect(details.previous_settlement_sol).toBe(1)
  })

  // --- penalty_expected ---

  it('emits penalty_expected on epoch change with bid_too_low penalty', () => {
    // bidTooLowPenaltyPmpe=0.5, stake=50000 => penalty = 0.5/1000*50000 = 25 SOL
    const validators = [
      makeValidator({
        revShare: {
          expectedMaxEffBidPmpe: 3.2,
          onchainDistributedPmpe: 0.5,
          bidTooLowPenaltyPmpe: 0.5,
          blacklistPenaltyPmpe: 0,
        },
        values: { bondRiskFeeSol: 0 },
      }),
    ]
    const previousState = new Map<string, ValidatorState>()
    // prev.epoch=929, current epoch=930 => epoch changed
    previousState.set(TEST_VOTE_ACCOUNT, makePrevState())

    const events = evaluateDeltas(
      validators,
      previousState,
      930,
      'bidding',
      logger,
    )

    const penalty = events.find(e => e.inner_type === 'penalty_expected')
    expect(penalty).toBeDefined()
    const details = penalty!.data.details as PenaltyExpectedDetails
    expect(details.bid_too_low_penalty_sol).toBe(25)
    expect(details.blacklist_penalty_sol).toBe(0)
    expect(details.bond_risk_fee_sol).toBe(0)
    expect(details.total_penalty_sol).toBe(25)
    expect(details.bid_too_low_penalty_pmpe).toBe(0.5)
    expect(details.marinade_activated_stake_sol).toBe(50000)
  })

  it('suppresses penalty_expected on same epoch', () => {
    const validators = [
      makeValidator({
        revShare: {
          expectedMaxEffBidPmpe: 3.2,
          onchainDistributedPmpe: 0.5,
          bidTooLowPenaltyPmpe: 0.5,
          blacklistPenaltyPmpe: 0,
        },
        values: { bondRiskFeeSol: 0 },
      }),
    ]
    const previousState = new Map<string, ValidatorState>()
    // prev.epoch=930 === current epoch=930 => no epoch change
    previousState.set(TEST_VOTE_ACCOUNT, makePrevState({ epoch: 930 }))

    const events = evaluateDeltas(
      validators,
      previousState,
      930,
      'bidding',
      logger,
    )

    const penalty = events.find(e => e.inner_type === 'penalty_expected')
    expect(penalty).toBeUndefined()
  })

  it('suppresses penalty_expected below threshold', () => {
    // bidTooLowPenaltyPmpe tiny => total <= 0.001 SOL
    const validators = [
      makeValidator({
        revShare: {
          expectedMaxEffBidPmpe: 3.2,
          onchainDistributedPmpe: 0.5,
          bidTooLowPenaltyPmpe: 0.00001,
          blacklistPenaltyPmpe: 0,
        },
        values: { bondRiskFeeSol: 0 },
      }),
    ]
    const previousState = new Map<string, ValidatorState>()
    previousState.set(TEST_VOTE_ACCOUNT, makePrevState())

    const events = evaluateDeltas(
      validators,
      previousState,
      930,
      'bidding',
      logger,
    )

    const penalty = events.find(e => e.inner_type === 'penalty_expected')
    expect(penalty).toBeUndefined()
  })

  it('emits penalty_expected with blacklist penalty', () => {
    const validators = [
      makeValidator({
        revShare: {
          expectedMaxEffBidPmpe: 3.2,
          onchainDistributedPmpe: 0.5,
          bidTooLowPenaltyPmpe: 0,
          blacklistPenaltyPmpe: 1.0,
        },
        values: { bondRiskFeeSol: 0 },
      }),
    ]
    const previousState = new Map<string, ValidatorState>()
    previousState.set(TEST_VOTE_ACCOUNT, makePrevState())

    const events = evaluateDeltas(
      validators,
      previousState,
      930,
      'bidding',
      logger,
    )

    const penalty = events.find(e => e.inner_type === 'penalty_expected')
    expect(penalty).toBeDefined()
    const details = penalty!.data.details as PenaltyExpectedDetails
    // blacklist = 1.0/1000 * 50000 = 50 SOL
    expect(details.blacklist_penalty_sol).toBe(50)
    expect(details.bid_too_low_penalty_sol).toBe(0)
    expect(details.total_penalty_sol).toBe(50)
  })

  it('emits penalty_expected with bond_risk_fee', () => {
    const validators = [
      makeValidator({
        revShare: {
          expectedMaxEffBidPmpe: 3.2,
          onchainDistributedPmpe: 0.5,
          bidTooLowPenaltyPmpe: 0,
          blacklistPenaltyPmpe: 0,
        },
        values: { bondRiskFeeSol: 5.5 },
      }),
    ]
    const previousState = new Map<string, ValidatorState>()
    previousState.set(TEST_VOTE_ACCOUNT, makePrevState())

    const events = evaluateDeltas(
      validators,
      previousState,
      930,
      'bidding',
      logger,
    )

    const penalty = events.find(e => e.inner_type === 'penalty_expected')
    expect(penalty).toBeDefined()
    const details = penalty!.data.details as PenaltyExpectedDetails
    expect(details.bond_risk_fee_sol).toBe(5.5)
    expect(details.bid_too_low_penalty_sol).toBe(0)
    expect(details.blacklist_penalty_sol).toBe(0)
    expect(details.total_penalty_sol).toBe(5.5)
  })

  it('emits penalty_expected with activating-stake fee fields', () => {
    // activating_stake_sol = max(0, SAM target 60000 - already activated 50000) = 10000
    // activating_stake_fee_sol = 10000 * 2.0 / 1000 = 20
    // total_penalty_sol must NOT include the activating-stake fee (it is a separate line item).
    const validators = [
      makeValidator({
        marinadeActivatedStakeSol: 50000,
        auctionStake: {
          marinadeSamTargetSol: 60000,
          externalActivatedSol: 0,
        },
        revShare: {
          expectedMaxEffBidPmpe: 3.2,
          onchainDistributedPmpe: 0.5,
          bidTooLowPenaltyPmpe: 0.5,
          blacklistPenaltyPmpe: 0,
          activatingStakePmpe: 2.0,
        },
        values: { bondRiskFeeSol: 0 },
      }),
    ]
    const previousState = new Map<string, ValidatorState>()
    previousState.set(TEST_VOTE_ACCOUNT, makePrevState())

    const events = evaluateDeltas(
      validators,
      previousState,
      930,
      'bidding',
      logger,
    )

    const penalty = events.find(e => e.inner_type === 'penalty_expected')
    expect(penalty).toBeDefined()
    const details = penalty!.data.details as PenaltyExpectedDetails
    expect(details.activating_stake_sol).toBe(10000)
    expect(details.activating_stake_pmpe).toBe(2.0)
    expect(details.activating_stake_fee_sol).toBe(20)
    // bid_too_low only: 0.5/1000 * 50000 = 25 SOL; activating-stake fee (20) is NOT rolled in.
    expect(details.total_penalty_sol).toBe(25)
  })

  it('emits penalty_expected when only activating-stake fee is present (no bond-side penalty)', () => {
    // penalties.total = 0 (no bidTooLow, no blacklist, no bondRiskFee)
    // activating_stake_sol = max(0, 60000 - 50000) = 10000; pmpe 3.0 => activating-stake fee = 30 SOL
    const validators = [
      makeValidator({
        marinadeActivatedStakeSol: 50000,
        auctionStake: {
          marinadeSamTargetSol: 60000,
          externalActivatedSol: 0,
        },
        revShare: {
          expectedMaxEffBidPmpe: 3.2,
          onchainDistributedPmpe: 0.5,
          bidTooLowPenaltyPmpe: 0,
          blacklistPenaltyPmpe: 0,
          activatingStakePmpe: 3.0,
        },
        values: { bondRiskFeeSol: 0 },
      }),
    ]
    const previousState = new Map<string, ValidatorState>()
    previousState.set(TEST_VOTE_ACCOUNT, makePrevState())

    const events = evaluateDeltas(
      validators,
      previousState,
      930,
      'bidding',
      logger,
    )

    const penalty = events.find(e => e.inner_type === 'penalty_expected')
    expect(penalty).toBeDefined()
    const details = penalty!.data.details as PenaltyExpectedDetails
    expect(details.total_penalty_sol).toBe(0)
    expect(details.activating_stake_fee_sol).toBe(30)
    // Emitter message uses the "activating-stake fee" wording and the
    // pure-fee template (no bond-side charges)
    expect(penalty!.data.message).toContain(
      'activating-stake fee of 30.0000 SOL',
    )
    expect(penalty!.data.message).toContain('separate from bond penalties')
  })

  it('emits penalty_expected with zero activating-stake fields when SAM target <= activated', () => {
    const validators = [
      makeValidator({
        marinadeActivatedStakeSol: 50000,
        auctionStake: {
          marinadeSamTargetSol: 40000,
          externalActivatedSol: 0,
        },
        revShare: {
          expectedMaxEffBidPmpe: 3.2,
          onchainDistributedPmpe: 0.5,
          bidTooLowPenaltyPmpe: 0.5,
          blacklistPenaltyPmpe: 0,
          activatingStakePmpe: 2.0,
        },
        values: { bondRiskFeeSol: 0 },
      }),
    ]
    const previousState = new Map<string, ValidatorState>()
    previousState.set(TEST_VOTE_ACCOUNT, makePrevState())

    const events = evaluateDeltas(
      validators,
      previousState,
      930,
      'bidding',
      logger,
    )

    const details = events.find(e => e.inner_type === 'penalty_expected')!.data
      .details as PenaltyExpectedDetails
    expect(details.activating_stake_sol).toBe(0)
    expect(details.activating_stake_fee_sol).toBe(0)
  })

  it('emits multiple events for multiple changes on same validator', () => {
    // Bond balance dropped AND cap constraint changed AND exited auction
    const validators = [
      makeValidator({
        bondBalanceSol: 1.0,
        claimableBondBalanceSol: 1.0,
        auctionStake: { marinadeSamTargetSol: 0, externalActivatedSol: 0 },
        lastCapConstraint: {
          constraintType: 'BOND',
          constraintName: 'bond_cap',
        },
        bondGoodForNEpochs: 0.5,
      }),
    ]
    const previousState = new Map<string, ValidatorState>()
    previousState.set(TEST_VOTE_ACCOUNT, makePrevState())

    const events = evaluateDeltas(
      validators,
      previousState,
      930,
      'bidding',
      logger,
    )

    const types = events.map(e => e.inner_type)
    expect(types).toContain('auction_exited')
    expect(types).toContain('cap_changed')
    expect(types).toContain('bond_underfunded_change')
    expect(types).toContain('bond_balance_change')
    expect(events.length).toBeGreaterThanOrEqual(4)
  })

  it('detects 1 lamport change', () => {
    // 10 SOL + 1 lamport = 10.000000001
    const validators = [makeValidator({ bondBalanceSol: 10.000000001 })]
    const previousState = new Map<string, ValidatorState>()
    previousState.set(
      TEST_VOTE_ACCOUNT,
      makePrevState({ funded_amount_lamports: 10_000_000_000n }),
    )

    const events = evaluateDeltas(
      validators,
      previousState,
      930,
      'bidding',
      logger,
    )

    const balanceChange = events.find(
      e => e.inner_type === 'bond_balance_change',
    )
    expect(balanceChange).toBeDefined()
    const lamportDetails = balanceChange!.data
      .details as BondBalanceChangeDetails
    expect(lamportDetails.delta_lamports).toBe('1')
  })
})

describe('validatorToState', () => {
  it('converts AuctionValidator to ValidatorState', () => {
    const v = makeValidator()
    const state = validatorToState(v, 930, 'bidding')

    expect(state.vote_account).toBe(TEST_VOTE_ACCOUNT)
    expect(state.bond_pubkey).toBe(expectedBondPubkey())
    expect(state.bond_type).toBe('bidding')
    expect(state.epoch).toBe(930)
    expect(state.in_auction).toBe(true)
    expect(state.bond_good_for_n_epochs).toBe(5) // rounded via roundEpochs
    expect(state.cap_constraint).toBeNull()
    expect(state.funded_amount_lamports).toBe(10_000_000_000n)
    expect(state.deficit_lamports).toBe(175_000_000_000n) // requiredSol(185) - bondBalance(10) = 175
    expect(state.sam_eligible).toBe(true)
  })
})
