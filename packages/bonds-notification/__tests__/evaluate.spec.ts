import { evaluate, matchesCondition } from '../src/evaluate'
import {
  loadThresholdConfig,
  resetThresholdConfigCache,
} from '../src/threshold-config'

import type { BondsEventV1, ThresholdConfig } from '../src/types'

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

describe('evaluate', () => {
  let config: ThresholdConfig

  beforeAll(async () => {
    resetThresholdConfigCache()
    config = await loadThresholdConfig()
  })

  describe('bond_underfunded_change', () => {
    it('currentEpochs=1 -> shouldNotify=true, priority=critical', () => {
      const event = makeEvent({
        data: {
          message: 'Coverage changed',
          details: { current_epochs: 1, deficit_sol: 5.0 },
        },
      })
      const result = evaluate(event, config)
      expect(result).not.toBeNull()
      expect(result!.shouldNotify).toBe(true)
      expect(result!.priority).toBe('critical')
      expect(result!.routingKey).toBe('bond_underfunded_change')
    })

    it('currentEpochs=5 -> shouldNotify=true, priority=warning', () => {
      const event = makeEvent({
        data: {
          message: 'Coverage changed',
          details: { current_epochs: 5, deficit_sol: 3.0 },
        },
      })
      const result = evaluate(event, config)
      expect(result).not.toBeNull()
      expect(result!.shouldNotify).toBe(true)
      expect(result!.priority).toBe('warning')
    })

    it('currentEpochs=15 -> shouldNotify=false (well-funded)', () => {
      const event = makeEvent({
        data: {
          message: 'Coverage changed',
          details: { current_epochs: 15 },
        },
      })
      const result = evaluate(event, config)
      expect(result).not.toBeNull()
      expect(result!.shouldNotify).toBe(false)
    })

    it('currentEpochs=null -> shouldNotify=true, priority=warning (defensive)', () => {
      const event = makeEvent({
        data: {
          message: 'Coverage changed',
          details: { current_epochs: null },
        },
      })
      const result = evaluate(event, config)
      expect(result).not.toBeNull()
      expect(result!.shouldNotify).toBe(true)
      expect(result!.priority).toBe('warning')
    })

    it('deficit_sol below min_deficit_sol -> shouldNotify=false', () => {
      const event = makeEvent({
        data: {
          message: 'Coverage changed',
          details: { current_epochs: 1, deficit_sol: 0.3 },
        },
      })
      const result = evaluate(event, config)
      expect(result).not.toBeNull()
      expect(result!.shouldNotify).toBe(false)
    })

    it('deficit_sol at min_deficit_sol boundary -> shouldNotify=true', () => {
      const event = makeEvent({
        data: {
          message: 'Coverage changed',
          details: { current_epochs: 1, deficit_sol: 0.5 },
        },
      })
      const result = evaluate(event, config)
      expect(result).not.toBeNull()
      expect(result!.shouldNotify).toBe(true)
    })

    it('generates notificationId for notifiable events', () => {
      const event = makeEvent({
        data: {
          message: 'Coverage changed',
          details: { current_epochs: 1, deficit_sol: 5.0 },
        },
      })
      const result = evaluate(event, config)
      expect(result).not.toBeNull()
      expect(result!.notificationId).toBeTruthy()
      expect(typeof result!.notificationId).toBe('string')
    })
  })

  describe('auction_exited', () => {
    it('shouldNotify=true, priority=critical', () => {
      const event = makeEvent({
        inner_type: 'auction_exited',
        data: {
          message: 'Exited auction',
          details: { previous_in_auction: true, current_in_auction: false },
        },
      })
      const result = evaluate(event, config)
      expect(result).not.toBeNull()
      expect(result!.shouldNotify).toBe(true)
      expect(result!.priority).toBe('critical')
      expect(result!.routingKey).toBe('auction_exited')
    })
  })

  describe('cap_changed', () => {
    it('current_cap=BOND -> shouldNotify=true, priority=warning', () => {
      const event = makeEvent({
        inner_type: 'cap_changed',
        data: {
          message: 'Cap changed',
          details: { previous_cap: null, current_cap: 'BOND' },
        },
      })
      const result = evaluate(event, config)
      expect(result).not.toBeNull()
      expect(result!.shouldNotify).toBe(true)
      expect(result!.priority).toBe('warning')
      expect(result!.routingKey).toBe('cap_changed')
    })

    it('current_cap=COUNTRY -> shouldNotify=false', () => {
      const event = makeEvent({
        inner_type: 'cap_changed',
        data: {
          message: 'Cap changed',
          details: { previous_cap: null, current_cap: 'COUNTRY' },
        },
      })
      const result = evaluate(event, config)
      expect(result).not.toBeNull()
      expect(result!.shouldNotify).toBe(false)
    })

    it('current_cap=null (cap removed) -> shouldNotify=false', () => {
      const event = makeEvent({
        inner_type: 'cap_changed',
        data: {
          message: 'Cap changed',
          details: { previous_cap: 'BOND', current_cap: null },
        },
      })
      const result = evaluate(event, config)
      expect(result).not.toBeNull()
      expect(result!.shouldNotify).toBe(false)
    })
  })

  describe('bond_removed', () => {
    it('shouldNotify=true, priority=critical', () => {
      const event = makeEvent({
        inner_type: 'bond_removed',
        data: {
          message: 'Bond removed',
          details: { last_known_funded_lamports: '1000000000' },
        },
      })
      const result = evaluate(event, config)
      expect(result).not.toBeNull()
      expect(result!.shouldNotify).toBe(true)
      expect(result!.priority).toBe('critical')
      expect(result!.routingKey).toBe('bond_removed')
    })
  })

  describe('announcement', () => {
    it('shouldNotify=true, notificationId=null', () => {
      const event = makeEvent({
        inner_type: 'announcement',
        data: {
          message: 'System announcement',
          details: {},
        },
      })
      const result = evaluate(event, config)
      expect(result).not.toBeNull()
      expect(result!.shouldNotify).toBe(true)
      expect(result!.priority).toBe('critical')
      expect(result!.notificationId).toBeNull()
      expect(result!.routingKey).toBe('announcement')
    })
  })

  describe('passthrough events', () => {
    it('first_seen -> shouldNotify=true, priority=info', () => {
      const event = makeEvent({
        inner_type: 'first_seen',
        data: {
          message: 'New bond detected',
          details: { bond_balance_sol: 10 },
        },
      })
      const result = evaluate(event, config)
      expect(result).not.toBeNull()
      expect(result!.shouldNotify).toBe(true)
      expect(result!.priority).toBe('info')
      expect(result!.routingKey).toBe('first_seen')
    })

    it('bond_balance_change -> shouldNotify=true, priority=info', () => {
      const event = makeEvent({
        inner_type: 'bond_balance_change',
        data: {
          message: 'Balance changed',
          details: {},
        },
      })
      const result = evaluate(event, config)
      expect(result).not.toBeNull()
      expect(result!.shouldNotify).toBe(true)
      expect(result!.priority).toBe('info')
    })

    it('version_bump -> shouldNotify=true, notificationId=null (skip_dedup)', () => {
      const event = makeEvent({
        inner_type: 'version_bump',
        data: {
          message: 'Version bumped',
          details: {},
        },
      })
      const result = evaluate(event, config)
      expect(result).not.toBeNull()
      expect(result!.shouldNotify).toBe(true)
      expect(result!.notificationId).toBeNull()
    })
  })

  describe('unknown inner_type', () => {
    it('returns null', () => {
      const event = makeEvent({
        inner_type: 'unknown_type' as BondsEventV1['inner_type'],
        data: {
          message: 'Unknown',
          details: {},
        },
      })
      const result = evaluate(event, config)
      expect(result).toBeNull()
    })
  })
})

describe('matchesCondition', () => {
  it('evaluates < operator', () => {
    expect(matchesCondition('currentEpochs < 2', 1)).toBe(true)
    expect(matchesCondition('currentEpochs < 2', 2)).toBe(false)
  })

  it('evaluates >= operator', () => {
    expect(matchesCondition('currentEpochs >= 10', 10)).toBe(true)
    expect(matchesCondition('currentEpochs >= 10', 9)).toBe(false)
  })

  it('throws on invalid condition', () => {
    expect(() => matchesCondition('invalid', 5)).toThrow(
      'Invalid condition expression',
    )
  })
})
