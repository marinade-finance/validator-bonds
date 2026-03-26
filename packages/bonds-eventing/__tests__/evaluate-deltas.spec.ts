import { bondAddress } from '@marinade.finance/validator-bonds-sdk'
import { PublicKey } from '@solana/web3.js'
import pino from 'pino'

import {
  evaluateDeltas,
  validatorToState,
  configAddressForBondType,
} from '../src/evaluate-deltas'

import type { ValidatorState } from '../src/types'
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
    expect(events[0]!.data.details.expected_max_eff_bid_pmpe).toBe(3.2)
    expect(events[0]!.data.details.epoch_cost_sol).toBeCloseTo(160) // (3.2/1000)*50000
    expect(events[0]!.data.details.deficit_sol).toBeDefined()
    expect(events[0]!.data.details.required_sol).toBeDefined()
  })

  it('emits bond_removed for missing validator', () => {
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
    expect(events[0]!.inner_type).toBe('bond_removed')
    expect(events[0]!.vote_account).toBe(TEST_VOTE_ACCOUNT)
    expect(events[0]!.bond_pubkey).toBe(expectedBondPubkey())
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
    expect(entered!.data.details.previous_in_auction).toBe(false)
    expect(entered!.data.details.current_in_auction).toBe(true)
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
    expect(exited!.data.details.previous_in_auction).toBe(true)
    expect(exited!.data.details.current_in_auction).toBe(false)
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
    expect(capChanged!.data.details.previous_cap).toBeNull()
    expect(capChanged!.data.details.current_cap).toBe('BOND')
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
    expect(underfunded!.data.details.previous_epochs).toBe(5)
    expect(underfunded!.data.details.current_epochs).toBe(2)
    // Deficit metrics derived from revShare
    expect(underfunded!.data.details.expected_max_eff_bid_pmpe).toBe(3.2)
    expect(underfunded!.data.details.epoch_cost_sol).toBeCloseTo(
      (3.2 / 1000) * 50000,
    ) // 160 SOL
    expect(underfunded!.data.details.deficit_sol).toBeGreaterThan(0)
    expect(underfunded!.data.details.required_sol).toBeGreaterThan(0)
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
    expect(balanceChange!.data.details.delta_lamports).toBe('-2000000000')
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
    expect(underfunded!.data.details.deficit_sol).toBeGreaterThan(175)
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
    expect(balanceChange!.data.details.delta_lamports).toBe('1')
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
