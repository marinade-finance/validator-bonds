import { createBondsNotificationBrain } from '../src/brain'

import type { BondsEventV1 } from '../src/types'

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

describe('BondsNotificationBrain', () => {
  const brain = createBondsNotificationBrain()

  it('full flow: underfunded event -> evaluate -> buildContent -> verify all fields', () => {
    const event = makeEvent({
      data: {
        message: 'Coverage dropped to 1 epoch',
        details: {
          current_epochs: 1,
          bond_balance_sol: 2.5,
          deficit_sol: 5.0,
        },
      },
    })

    const evaluation = brain.evaluate(event)
    expect(evaluation).not.toBeNull()
    expect(evaluation!.shouldNotify).toBe(true)
    expect(evaluation!.priority).toBe('critical')
    expect(evaluation!.notificationId).toBeTruthy()

    const content = brain.buildContent(event, evaluation!)
    expect(content.title).toBe('Bond Underfunded')
    expect(content.body).toBe('Coverage dropped to 1 epoch')
    expect(content.dataPoints).toBeDefined()
    expect(content.dataPoints!.length).toBeGreaterThanOrEqual(2)
  })

  it('full flow: auction_exited -> critical priority', () => {
    const event = makeEvent({
      inner_type: 'auction_exited',
      data: {
        message: 'Validator exited the auction',
        details: {},
      },
    })

    const evaluation = brain.evaluate(event)
    expect(evaluation).not.toBeNull()
    expect(evaluation!.shouldNotify).toBe(true)
    expect(evaluation!.priority).toBe('critical')

    const content = brain.buildContent(event, evaluation!)
    expect(content.title).toBe('Removed from Auction')
  })

  it('announcement -> skip dedup, critical priority', () => {
    const event = makeEvent({
      inner_type: 'announcement',
      vote_account: 'MarinadeNotifications1111111111111111111111',
      data: {
        message: 'System maintenance scheduled',
        details: {},
      },
    })

    const evaluation = brain.evaluate(event)
    expect(evaluation).not.toBeNull()
    expect(evaluation!.shouldNotify).toBe(true)
    expect(evaluation!.priority).toBe('critical')
    expect(evaluation!.notificationId).toBeNull()
  })

  it('event with all null details -> graceful handling, no crash', () => {
    const event = makeEvent({
      data: {
        message: 'Event with sparse data',
        details: {
          current_epochs: null,
          bond_balance_sol: null,
          deficit_sol: null,
        },
      },
    })

    const evaluation = brain.evaluate(event)
    expect(evaluation).not.toBeNull()
    // With null current_epochs, falls into defensive path
    expect(evaluation!.shouldNotify).toBe(true)
    expect(evaluation!.priority).toBe('warning')

    // buildContent should not crash on null details
    const content = brain.buildContent(event, evaluation!)
    expect(content.title).toBe('Bond Underfunded')
    expect(content.body).toBeTruthy()
  })

  it('extractUserId returns vote_account', () => {
    const event = makeEvent()
    expect(brain.extractUserId(event)).toBe(event.vote_account)
  })
})
