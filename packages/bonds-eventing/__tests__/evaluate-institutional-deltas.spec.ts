import pino from 'pino'

import {
  evaluateInstitutionalDeltas,
  institutionalValidatorToState,
} from '../src/evaluate-institutional-deltas'
import { computeFlatDeficit } from '../src/run-institutional'

import type {
  BondUnderfundedChangeDetails,
  FirstSeenDetails,
  InstitutionalValidatorData,
  SettlementAppliedDetails,
  ValidatorDelistedDetails,
  ValidatorState,
} from '../src/types'

const logger = pino({ level: 'silent' })

const TEST_VOTE_ACCOUNT = '11111111111111111111111111111112'
const TEST_BOND_PUBKEY = 'BondPubkey11111111111111111111111111111111'

function makeValidator(
  overrides: Partial<InstitutionalValidatorData> = {},
): InstitutionalValidatorData {
  return {
    voteAccount: TEST_VOTE_ACCOUNT,
    bondPubkey: TEST_BOND_PUBKEY,
    fundedAmountLamports: 10_000_000_000n, // 10 SOL
    effectiveAmountLamports: 10_000_000_000n,
    settlementClaimsLamports: 0n,
    institutionalStakeLamports: 30_000_000_000_000n, // 30k SOL -> requires 15 SOL
    ...overrides,
  }
}

function makePrevState(
  overrides: Partial<ValidatorState> = {},
): ValidatorState {
  return {
    vote_account: TEST_VOTE_ACCOUNT,
    bond_pubkey: TEST_BOND_PUBKEY,
    bond_type: 'institutional',
    epoch: 992,
    in_auction: false,
    bond_good_for_n_epochs: null,
    cap_constraint: null,
    cap_marinade_stake_sol: null,
    funded_amount_lamports: 10_000_000_000n,
    effective_amount_lamports: 10_000_000_000n,
    auction_stake_lamports: 0n,
    deficit_lamports: 5_000_000_000n, // 30k/2000 = 15 SOL required - 10 SOL effective
    settlement_claims_lamports: 0n,
    sam_eligible: false,
    updated_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('computeFlatDeficit', () => {
  it('requires 1 SOL of bond per 2000 SOL of stake (floor division)', () => {
    const { requiredLamports, deficitLamports } = computeFlatDeficit(
      30_000_000_000_001n,
      10_000_000_000n,
    )
    expect(requiredLamports).toBe(15_000_000_000n)
    expect(deficitLamports).toBe(5_000_000_000n)
  })

  it('returns zero deficit for a well-funded bond', () => {
    const { deficitLamports } = computeFlatDeficit(
      30_000_000_000_000n,
      20_000_000_000n,
    )
    expect(deficitLamports).toBe(0n)
  })

  it('returns zero required for zero stake', () => {
    const { requiredLamports, deficitLamports } = computeFlatDeficit(0n, 0n)
    expect(requiredLamports).toBe(0n)
    expect(deficitLamports).toBe(0n)
  })
})

describe('evaluateInstitutionalDeltas', () => {
  it('emits first_seen with schema-required auction fields defaulted', () => {
    const events = evaluateInstitutionalDeltas(
      [makeValidator()],
      new Map(),
      993,
      logger,
    )

    expect(events).toHaveLength(1)
    const event = events[0]!
    expect(event.inner_type).toBe('first_seen')
    expect(event.bond_type).toBe('institutional')
    expect(event.bond_pubkey).toBe(TEST_BOND_PUBKEY)
    expect(event.epoch).toBe(993)
    const details = event.data.details as FirstSeenDetails
    expect(details.in_auction).toBe(false)
    expect(details.sam_eligible).toBe(false)
    expect(details.auction_stake_sol).toBe(0)
    expect(details.bond_balance_sol).toBe(10)
    expect(details.marinade_activated_stake_sol).toBe(30_000)
    expect(details.required_sol).toBe(15)
    expect(details.deficit_sol).toBe(5)
    expect(details.bond_good_for_n_epochs).toBeNull()
    expect(details.epoch_cost_sol).toBeNull()
    expect(details.expected_max_eff_bid_pmpe).toBeNull()
  })

  it('emits bond_underfunded_change when deficit changes', () => {
    // Stake grew: 40k SOL now requires 20 SOL -> deficit 10 SOL (was 5)
    const validators = [
      makeValidator({ institutionalStakeLamports: 40_000_000_000_000n }),
    ]
    const previousState = new Map([[TEST_VOTE_ACCOUNT, makePrevState()]])

    const events = evaluateInstitutionalDeltas(
      validators,
      previousState,
      993,
      logger,
    )

    expect(events).toHaveLength(1)
    const event = events[0]!
    expect(event.inner_type).toBe('bond_underfunded_change')
    const details = event.data.details as BondUnderfundedChangeDetails
    expect(details.previous_epochs).toBeNull()
    expect(details.current_epochs).toBeNull()
    expect(details.previous_deficit_sol).toBe(5)
    expect(details.deficit_sol).toBe(10)
    expect(details.required_sol).toBe(20)
    expect(details.bond_balance_sol).toBe(10)
    expect(details.marinade_activated_stake_sol).toBe(40_000)
    expect(details.epoch_cost_sol).toBeNull()
    expect(details.expected_max_eff_bid_pmpe).toBeNull()
    expect(event.data.message).toContain('top-up needed 5 → 10 SOL')
    expect(event.data.message).toContain('required 20 SOL')
  })

  it('emits bond_underfunded_change when deficit improves to zero', () => {
    const validators = [
      makeValidator({
        effectiveAmountLamports: 20_000_000_000n,
        fundedAmountLamports: 10_000_000_000n,
      }),
    ]
    const previousState = new Map([
      [
        TEST_VOTE_ACCOUNT,
        makePrevState({ effective_amount_lamports: 20_000_000_000n }),
      ],
    ])

    const events = evaluateInstitutionalDeltas(
      validators,
      previousState,
      993,
      logger,
    )

    const underfunded = events.filter(
      e => e.inner_type === 'bond_underfunded_change',
    )
    expect(underfunded).toHaveLength(1)
    const details = underfunded[0]!.data.details as BondUnderfundedChangeDetails
    expect(details.deficit_sol).toBe(0)
    expect(details.previous_deficit_sol).toBe(5)
  })

  it('emits nothing when nothing changed', () => {
    const events = evaluateInstitutionalDeltas(
      [makeValidator()],
      new Map([[TEST_VOTE_ACCOUNT, makePrevState()]]),
      993,
      logger,
    )
    expect(events).toHaveLength(0)
  })

  it('emits bond_balance_change on funded amount change', () => {
    const validators = [
      makeValidator({ fundedAmountLamports: 12_000_000_000n }),
    ]
    const previousState = new Map([[TEST_VOTE_ACCOUNT, makePrevState()]])

    const events = evaluateInstitutionalDeltas(
      validators,
      previousState,
      993,
      logger,
    )

    const balanceEvents = events.filter(
      e => e.inner_type === 'bond_balance_change',
    )
    expect(balanceEvents).toHaveLength(1)
  })

  it('emits settlement_applied from settlement claims above dust, none below', () => {
    // 1 SOL of settlement claims: effective = funded - claims
    const withSettlement = evaluateInstitutionalDeltas(
      [
        makeValidator({
          effectiveAmountLamports: 9_000_000_000n,
          settlementClaimsLamports: 1_000_000_000n,
        }),
      ],
      new Map([[TEST_VOTE_ACCOUNT, makePrevState()]]),
      993,
      logger,
    )
    const settlements = withSettlement.filter(
      e => e.inner_type === 'settlement_applied',
    )
    expect(settlements).toHaveLength(1)
    const details = settlements[0]!.data.details as SettlementAppliedDetails
    expect(details.settlement_total_sol).toBe(1)
    expect(details.bond_good_for_n_epochs).toBeNull()
    expect(details.claimable_balance_sol).toBe(9)

    // 0.005 SOL of claims -> below 0.01 SOL dust gate
    const belowDust = evaluateInstitutionalDeltas(
      [
        makeValidator({
          effectiveAmountLamports: 9_995_000_000n,
          settlementClaimsLamports: 5_000_000n,
        }),
      ],
      new Map([[TEST_VOTE_ACCOUNT, makePrevState()]]),
      993,
      logger,
    )
    expect(
      belowDust.filter(e => e.inner_type === 'settlement_applied'),
    ).toHaveLength(0)
  })

  it('does not emit settlement_applied for a pending withdraw request', () => {
    // effective drops by 1 SOL from a withdraw request; settlement claims unchanged
    const events = evaluateInstitutionalDeltas(
      [makeValidator({ effectiveAmountLamports: 9_000_000_000n })],
      new Map([[TEST_VOTE_ACCOUNT, makePrevState()]]),
      993,
      logger,
    )
    expect(
      events.filter(e => e.inner_type === 'settlement_applied'),
    ).toHaveLength(0)
    // the reduced collateral still surfaces through the deficit
    expect(
      events.filter(e => e.inner_type === 'bond_underfunded_change'),
    ).toHaveLength(1)
  })

  it('emits validator_delisted for removed funded bond only', () => {
    const funded = makePrevState()
    const unfunded = makePrevState({
      vote_account: '11111111111111111111111111111113',
      funded_amount_lamports: 0n,
    })
    const previousState = new Map([
      [funded.vote_account, funded],
      [unfunded.vote_account, unfunded],
    ])

    const events = evaluateInstitutionalDeltas([], previousState, 993, logger)

    expect(events).toHaveLength(1)
    const event = events[0]!
    expect(event.inner_type).toBe('validator_delisted')
    expect(event.vote_account).toBe(TEST_VOTE_ACCOUNT)
    expect(event.bond_pubkey).toBe(TEST_BOND_PUBKEY)
    const details = event.data.details as ValidatorDelistedDetails
    expect(details.last_known_in_auction).toBe(false)
    expect(details.last_known_sam_eligible).toBe(false)
    expect(event.data.message).toContain('no longer reported by the bonds API')
  })

  it('never emits auction-only event types', () => {
    // Everything changes at once: still only generic event types allowed
    const validators = [
      makeValidator({
        fundedAmountLamports: 25_000_000_000n,
        effectiveAmountLamports: 20_000_000_000n,
        institutionalStakeLamports: 100_000_000_000_000n,
      }),
    ]
    const previousState = new Map([[TEST_VOTE_ACCOUNT, makePrevState()]])

    const events = evaluateInstitutionalDeltas(
      validators,
      previousState,
      993,
      logger,
    )

    const allowed = new Set([
      'first_seen',
      'bond_underfunded_change',
      'bond_balance_change',
      'settlement_applied',
      'validator_delisted',
    ])
    expect(events.length).toBeGreaterThan(0)
    for (const event of events) {
      expect(allowed.has(event.inner_type)).toBe(true)
    }
  })
})

describe('institutionalValidatorToState', () => {
  it('converts InstitutionalValidatorData to ValidatorState', () => {
    const state = institutionalValidatorToState(makeValidator(), 993)

    expect(state.vote_account).toBe(TEST_VOTE_ACCOUNT)
    expect(state.bond_pubkey).toBe(TEST_BOND_PUBKEY)
    expect(state.bond_type).toBe('institutional')
    expect(state.epoch).toBe(993)
    expect(state.in_auction).toBe(false)
    expect(state.sam_eligible).toBe(false)
    expect(state.bond_good_for_n_epochs).toBeNull()
    expect(state.cap_constraint).toBeNull()
    expect(state.funded_amount_lamports).toBe(10_000_000_000n)
    expect(state.effective_amount_lamports).toBe(10_000_000_000n)
    expect(state.auction_stake_lamports).toBe(0n)
    expect(state.deficit_lamports).toBe(5_000_000_000n)
    expect(state.settlement_claims_lamports).toBe(0n)
    expect(state.auction_validator).toBeUndefined()
  })
})
