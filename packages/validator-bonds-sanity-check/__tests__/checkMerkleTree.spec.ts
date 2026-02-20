import { NULL_LOG } from '@marinade.finance/ts-common'
import Decimal from 'decimal.js'

import {
  extractMetrics,
  reportMerkleTreeAnomalies,
  detectIndividualAnomaly,
} from '../src/commands/checkMerkleTree'

import type { MerkleTreeMetrics } from '../src/commands/checkMerkleTree'
import type { UnifiedMerkleTreesDto } from '../src/dtoMerkleTree'

// Minimal mock that satisfies extractMetrics' field access pattern
function mockDto(
  epoch: number,
  trees: { claims: bigint[] }[],
): UnifiedMerkleTreesDto {
  return {
    epoch,
    merkle_trees: trees.map(t => ({
      tree_nodes: t.claims.map(claim => ({ claim })),
    })),
  } as unknown as UnifiedMerkleTreesDto
}

function mockMetrics(overrides: Partial<MerkleTreeMetrics>): MerkleTreeMetrics {
  return {
    epoch: 100,
    totalValidators: 10,
    totalClaims: 50,
    totalClaimAmount: 1000000n,
    avgClaimAmountPerValidator: new Decimal(100000),
    avgClaimsPerValidator: new Decimal(5),
    ...overrides,
  }
}

describe('extractMetrics', () => {
  it('calculates metrics for a single tree with one node', () => {
    const dto = mockDto(100, [{ claims: [5000n] }])
    const metrics = extractMetrics(dto)

    expect(metrics.epoch).toBe(100)
    expect(metrics.totalValidators).toBe(1)
    expect(metrics.totalClaims).toBe(1)
    expect(metrics.totalClaimAmount).toBe(5000n)
    expect(metrics.avgClaimAmountPerValidator.toNumber()).toBe(5000)
    expect(metrics.avgClaimsPerValidator.toNumber()).toBe(1)
  })

  it('calculates metrics for multiple trees with multiple nodes', () => {
    const dto = mockDto(200, [
      { claims: [1000n, 2000n, 3000n] },
      { claims: [4000n, 5000n] },
    ])
    const metrics = extractMetrics(dto)

    expect(metrics.epoch).toBe(200)
    expect(metrics.totalValidators).toBe(2)
    expect(metrics.totalClaims).toBe(5)
    expect(metrics.totalClaimAmount).toBe(15000n)
    // 15000 / 2 = 7500
    expect(metrics.avgClaimAmountPerValidator.toNumber()).toBe(7500)
    // 5 / 2 = 2.5
    expect(metrics.avgClaimsPerValidator.toNumber()).toBe(2.5)
  })

  it('handles empty merkle_trees array', () => {
    const dto = mockDto(300, [])
    const metrics = extractMetrics(dto)

    expect(metrics.totalValidators).toBe(0)
    expect(metrics.totalClaims).toBe(0)
    expect(metrics.totalClaimAmount).toBe(0n)
    expect(metrics.avgClaimAmountPerValidator.toNumber()).toBe(0)
    expect(metrics.avgClaimsPerValidator.toNumber()).toBe(0)
  })
})

describe('reportMerkleTreeAnomalies', () => {
  const defaultThresholds = {
    correlationThreshold: new Decimal(0.15),
    scoreThreshold: new Decimal(2.0),
    minAbsoluteDeviationRatio: new Decimal(0.05),
  }

  it('throws when fewer than 3 historical data points', () => {
    const current = mockMetrics({ epoch: 103 })
    const historical = [
      mockMetrics({ epoch: 101 }),
      mockMetrics({ epoch: 102 }),
    ]

    expect(() =>
      reportMerkleTreeAnomalies({
        currentMetrics: current,
        historicalMetrics: historical,
        logger: NULL_LOG,
        ...defaultThresholds,
      }),
    ).toThrow()
  })

  it('returns no anomaly when current metrics are similar to historical', () => {
    const historical = [
      mockMetrics({ epoch: 100 }),
      mockMetrics({ epoch: 101 }),
      mockMetrics({ epoch: 102 }),
    ]
    const current = mockMetrics({ epoch: 103 })

    const result = reportMerkleTreeAnomalies({
      currentMetrics: current,
      historicalMetrics: historical,
      logger: NULL_LOG,
      ...defaultThresholds,
    })

    expect(result.anomalyDetected).toBe(false)
    expect(result.report).toContain('NORMAL')
  })

  it('detects anomaly when current metrics deviate wildly', () => {
    const historical = [
      mockMetrics({ epoch: 100, totalValidators: 100 }),
      mockMetrics({ epoch: 101, totalValidators: 102 }),
      mockMetrics({ epoch: 102, totalValidators: 98 }),
    ]
    // Extreme deviation: 100 → 10
    const current = mockMetrics({ epoch: 103, totalValidators: 10 })

    const result = reportMerkleTreeAnomalies({
      currentMetrics: current,
      historicalMetrics: historical,
      logger: NULL_LOG,
      ...defaultThresholds,
    })

    expect(result.anomalyDetected).toBe(true)
    expect(result.report).toContain('ANOMALY DETECTED')
  })
})

describe('detectIndividualAnomaly', () => {
  const defaultThresholds = {
    correlationThreshold: new Decimal(0.15),
    scoreThreshold: new Decimal(2.0),
    minAbsoluteDeviationRatio: new Decimal(0.05),
  }

  it('returns no anomaly for values within normal range', () => {
    const result = detectIndividualAnomaly({
      currentValue: 100,
      historicalValues: [98, 102, 100, 99, 101],
      field: 'testField',
      ...defaultThresholds,
      logger: NULL_LOG,
    })

    expect(result.isAnomaly).toBe(false)
  })

  it('flags anomaly for extreme outlier', () => {
    const result = detectIndividualAnomaly({
      currentValue: 500,
      historicalValues: [100, 102, 98, 101, 99],
      field: 'testField',
      ...defaultThresholds,
      logger: NULL_LOG,
    })

    expect(result.isAnomaly).toBe(true)
  })

  it('similarToAllRecent suppresses anomaly flag', () => {
    // Historical has a trend change: first 3 values are ~100, last 2 jump to ~500.
    // Current value 500 is similar to recent values (within 15% of 490 and 510).
    const result = detectIndividualAnomaly({
      currentValue: 500,
      historicalValues: [100, 100, 100, 490, 510],
      field: 'testField',
      ...defaultThresholds,
      logger: NULL_LOG,
    })

    expect(result.isAnomaly).toBe(false)
  })

  it('absolute deviation below threshold is not flagged', () => {
    // All values very close; even if z-score is slightly elevated,
    // the absolute deviation ratio from the mean is below 5%.
    const result = detectIndividualAnomaly({
      currentValue: 103,
      historicalValues: [100, 100, 100, 100, 100],
      field: 'testField',
      correlationThreshold: new Decimal(0.15),
      scoreThreshold: new Decimal(0.5), // very low threshold to trigger z-score
      minAbsoluteDeviationRatio: new Decimal(0.05),
      logger: NULL_LOG,
    })

    expect(result.isAnomaly).toBe(false)
    expect(result.details.meetsAbsoluteThreshold).toBe(false)
  })

  it('includes field description when provided', () => {
    const result = detectIndividualAnomaly({
      currentValue: 100,
      historicalValues: [100, 100, 100],
      field: 'testField',
      description: 'Test field description',
      ...defaultThresholds,
      logger: NULL_LOG,
    })

    expect(result.description).toBe('Test field description')
  })
})
