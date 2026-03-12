import { buildContent } from '../src/content'

import type { BondsEventV1, EvaluationResult } from '../src/types'

function makeEvent(overrides: Partial<BondsEventV1> = {}): BondsEventV1 {
  return {
    type: 'bonds',
    inner_type: 'bond_underfunded_change',
    vote_account: 'TestVoteAccount1111111111111111111111111111',
    bond_pubkey: 'TestBondPubkey111111111111111111111111111111',
    bond_type: 'bidding',
    epoch: 930,
    data: {
      message: 'Test event message',
      details: {},
    },
    created_at: '2025-01-15T12:00:00.000Z',
    ...overrides,
  }
}

function makeEvaluation(
  overrides: Partial<EvaluationResult> = {},
): EvaluationResult {
  return {
    shouldNotify: true,
    priority: 'warning',
    relevanceHours: 120,
    notificationId: 'test-id',
    routingKey: 'bond_underfunded_change',
    ...overrides,
  }
}

describe('buildContent', () => {
  it('bond_underfunded_change -> title "Bond Underfunded", dataPoints include coverage + deficit', () => {
    const event = makeEvent({
      data: {
        message: 'Coverage changed from 5 to 1 epochs',
        details: {
          current_epochs: 1,
          bond_balance_sol: 2.5,
          deficit_sol: 3.0,
        },
      },
    })
    const content = buildContent(event, makeEvaluation())
    expect(content.title).toBe('Bond Underfunded')
    expect(content.body).toBe('Coverage changed from 5 to 1 epochs')
    expect(content.dataPoints).toEqual(
      expect.arrayContaining([
        { label: 'Coverage', value: '1 epochs' },
        { label: 'Balance', value: '2.5 SOL' },
        { label: 'Deficit', value: '3 SOL' },
      ]),
    )
  })

  it('bond_underfunded_change without deficit_sol omits deficit dataPoint', () => {
    const event = makeEvent({
      data: {
        message: 'Coverage changed',
        details: { current_epochs: 1, bond_balance_sol: 2.5 },
      },
    })
    const content = buildContent(event, makeEvaluation())
    expect(content.dataPoints).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'Deficit' })]),
    )
  })

  it('auction_exited -> title "Removed from Auction"', () => {
    const event = makeEvent({
      inner_type: 'auction_exited',
      data: {
        message: 'Validator exited the auction',
        details: {},
      },
    })
    const content = buildContent(
      event,
      makeEvaluation({ routingKey: 'auction_exited' }),
    )
    expect(content.title).toBe('Removed from Auction')
    expect(content.body).toBe('Validator exited the auction')
  })

  it('cap_changed -> title "Stake Cap Changed", dataPoints include previous/current cap', () => {
    const event = makeEvent({
      inner_type: 'cap_changed',
      data: {
        message: 'Cap changed from none to BOND',
        details: { previous_cap: null, current_cap: 'BOND' },
      },
    })
    const content = buildContent(
      event,
      makeEvaluation({ routingKey: 'cap_changed' }),
    )
    expect(content.title).toBe('Stake Cap Changed')
    expect(content.dataPoints).toEqual([
      { label: 'Previous cap', value: 'none' },
      { label: 'Current cap', value: 'BOND' },
    ])
  })

  it('first_seen -> title "New Bond Detected"', () => {
    const event = makeEvent({
      inner_type: 'first_seen',
      data: {
        message: 'New bond detected',
        details: { bond_balance_sol: 10, in_auction: true },
      },
    })
    const content = buildContent(
      event,
      makeEvaluation({ routingKey: 'first_seen' }),
    )
    expect(content.title).toBe('New Bond Detected')
    expect(content.dataPoints).toEqual([
      { label: 'Balance', value: '10 SOL' },
      { label: 'In auction', value: 'true' },
    ])
  })

  it('unknown inner_type -> title = inner_type, body = raw message', () => {
    const event = makeEvent({
      inner_type: 'unknown_type' as BondsEventV1['inner_type'],
      data: {
        message: 'Some unknown event',
        details: {},
      },
    })
    const content = buildContent(
      event,
      makeEvaluation({ routingKey: 'unknown_type' }),
    )
    expect(content.title).toBe('unknown_type')
    expect(content.body).toBe('Some unknown event')
  })
})
