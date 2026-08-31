import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { CLIContext, readLargeJsonFile } from '@marinade.finance/cli-common'
import { NULL_LOG, setContext } from '@marinade.finance/ts-common'
import { PublicKey } from '@solana/web3.js'
import Decimal from 'decimal.js'

import {
  extractMetrics,
  reportMerkleTreeAnomalies,
  detectIndividualAnomaly,
  checkEpochHopGuardrail,
  checkFeeRevenueCeiling,
  loadFeeRevenueCeiling,
  checkTotalClaimsCeiling,
  validateMaxTotalClaims,
} from '../src/commands/checkMerkleTree'

import type { MerkleTreeMetrics } from '../src/commands/checkMerkleTree'
import type { MerkleTree, UnifiedMerkleTreesDto } from '../src/dtoMerkleTree'

beforeAll(() => {
  setContext(new CLIContext({ logger: NULL_LOG, commandName: 'test' }))
})

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

  it('totalClaims blow-up alone is advisory and does not block', () => {
    const historical = [
      mockMetrics({ epoch: 100, totalClaims: 1300 }),
      mockMetrics({ epoch: 101, totalClaims: 1400 }),
      mockMetrics({ epoch: 102, totalClaims: 1350 }),
    ]
    // 50x fan-out with every value metric untouched
    const current = mockMetrics({ epoch: 103, totalClaims: 65000 })

    const result = reportMerkleTreeAnomalies({
      currentMetrics: current,
      historicalMetrics: historical,
      logger: NULL_LOG,
      ...defaultThresholds,
    })

    const claims = result.stats.find(s => s.field.startsWith('totalClaims'))
    expect(claims?.isAnomaly).toBe(true)
    expect(claims?.advisory).toBe(true)
    expect(result.anomalyDetected).toBe(false)
    expect(result.report).toContain('NORMAL')
    expect(result.report).toContain('advisory, not blocking')
  })

  it('an advisory blow-up does not mask a scored-field anomaly', () => {
    const historical = [
      mockMetrics({ epoch: 100, totalClaims: 1300, totalValidators: 100 }),
      mockMetrics({ epoch: 101, totalClaims: 1400, totalValidators: 102 }),
      mockMetrics({ epoch: 102, totalClaims: 1350, totalValidators: 98 }),
    ]
    const current = mockMetrics({
      epoch: 103,
      totalClaims: 65000,
      totalValidators: 10,
    })

    const result = reportMerkleTreeAnomalies({
      currentMetrics: current,
      historicalMetrics: historical,
      logger: NULL_LOG,
      ...defaultThresholds,
    })

    expect(result.anomalyDetected).toBe(true)
    expect(result.report).toContain('ANOMALY DETECTED')
  })

  it('passes on the real epoch 1011 metrics that used to block the pipeline', () => {
    const totalValidators = [75, 77, 77, 77, 76, 77, 79, 77, 78, 79]
    const totalClaims = [
      9329, 4291, 9404, 12816, 14889, 26088, 7598, 14729, 4276, 1306,
    ]
    const totalClaimAmount = [
      204148374702n,
      194017138827n,
      197629908781n,
      197086635708n,
      201038441562n,
      217446089148n,
      192593752943n,
      205522065380n,
      194528984607n,
      187582809648n,
    ]
    const avgClaimAmountPerValidator = [
      2721978329, 2519703101, 2566622191, 2559566697, 2645242652, 2823975183,
      2437895606, 2669117732, 2493961341, 2374465944,
    ]

    const historical = totalClaims.map((claims, i) =>
      mockMetrics({
        epoch: 1001 + i,
        totalValidators: totalValidators[i],
        totalClaims: claims,
        totalClaimAmount: totalClaimAmount[i],
        avgClaimAmountPerValidator: new Decimal(avgClaimAmountPerValidator[i]!),
      }),
    )
    const current = mockMetrics({
      epoch: 1011,
      totalValidators: 79,
      totalClaims: 65194,
      totalClaimAmount: 215656202537n,
      avgClaimAmountPerValidator: new Decimal(2729825348),
    })

    const result = reportMerkleTreeAnomalies({
      currentMetrics: current,
      historicalMetrics: historical,
      logger: NULL_LOG,
      ...defaultThresholds,
    })

    const claims = result.stats.find(s => s.field.startsWith('totalClaims'))
    expect(claims?.isAnomaly).toBe(true)
    expect(claims?.advisory).toBe(true)
    expect(result.anomalyDetected).toBe(false)
  })
})

describe('checkTotalClaimsCeiling', () => {
  it('passes when total claims are below the ceiling', () => {
    const { exceeded, report } = checkTotalClaimsCeiling({
      epoch: 1011,
      totalClaims: 65194,
      maxTotalClaims: new Decimal(150_000),
    })

    expect(exceeded).toBe(false)
    expect(report).toContain('WITHIN CEILING')
  })

  it('fails when total claims exceed the ceiling', () => {
    const { exceeded, report } = checkTotalClaimsCeiling({
      epoch: 1011,
      totalClaims: 150_001,
      maxTotalClaims: new Decimal(150_000),
    })

    expect(exceeded).toBe(true)
    expect(report).toContain('CEILING EXCEEDED')
  })

  it('treats a value equal to the ceiling as within it', () => {
    const { exceeded } = checkTotalClaimsCeiling({
      epoch: 1011,
      totalClaims: 150_000,
      maxTotalClaims: new Decimal(150_000),
    })

    expect(exceeded).toBe(false)
  })

  it('fails on the full-fan-out case of every validator paying stakers', () => {
    // 79 validators x ~5.5k native stake accounts each
    const { exceeded } = checkTotalClaimsCeiling({
      epoch: 1012,
      totalClaims: 434_500,
      maxTotalClaims: new Decimal(150_000),
    })

    expect(exceeded).toBe(true)
  })
})

describe('checkFeeRevenueCeiling', () => {
  const DAO = 'mDAo14E6YJfEHcVZLcc235RVjviypmKMhftq7jeiLJz'
  const MARINADE = 'BBaQsiRo744NAYaqL3nKRfgeJayoqVicEQsEnLpfsJ6x'
  const STAKER = '4bZ6o3eUUNXhKuqjdCnCoPAoLgWiuLYixKaxoa8PpiKk'

  function mockTrees(
    trees: { authority: string; claim: bigint }[][],
  ): MerkleTree[] {
    return trees.map(
      nodes =>
        ({
          tree_nodes: nodes.map(({ authority, claim }) => ({
            stake_authority: new PublicKey(authority),
            claim,
          })),
        }) as unknown as MerkleTree,
    )
  }

  it('passes on the epoch 1010 shape where the fee is capped below min_sol_revenue', () => {
    const { exceeded, feeRevenueSol, report } = checkFeeRevenueCeiling({
      epoch: 1010,
      merkleTrees: mockTrees([
        [
          { authority: DAO, claim: 168_101_753_000n },
          { authority: MARINADE, claim: 18_677_973_000n },
          { authority: STAKER, claim: 803_083_988n },
        ],
      ]),
      feeAuthorities: [DAO, MARINADE],
      maxFeeRevenueSol: new Decimal(201),
    })

    expect(exceeded).toBe(false)
    expect(feeRevenueSol.toFixed(6)).toBe('186.779726')
    expect(report).toContain('WITHIN CEILING')
  })

  it('sums fee claims across every validator tree', () => {
    const { feeRevenueSol } = checkFeeRevenueCeiling({
      epoch: 1021,
      merkleTrees: mockTrees([
        [
          { authority: DAO, claim: 90_000_000_000n },
          { authority: MARINADE, claim: 10_000_000_000n },
        ],
        [
          { authority: DAO, claim: 90_000_000_000n },
          { authority: MARINADE, claim: 10_000_000_000n },
        ],
      ]),
      feeAuthorities: [DAO, MARINADE],
      maxFeeRevenueSol: new Decimal(201),
    })

    expect(feeRevenueSol.toFixed(0)).toBe('200')
  })

  it('fails when the fee optimizer over-collects against the ceiling', () => {
    const { exceeded, report } = checkFeeRevenueCeiling({
      epoch: 1021,
      merkleTrees: mockTrees([
        [
          { authority: DAO, claim: 234_000_000_000n },
          { authority: MARINADE, claim: 26_000_000_000n },
          { authority: STAKER, claim: 1_000_000_000n },
        ],
      ]),
      feeAuthorities: [DAO, MARINADE],
      maxFeeRevenueSol: new Decimal(201),
    })

    expect(exceeded).toBe(true)
    expect(report).toContain('CEILING EXCEEDED')
  })

  it('ignores claims of stakers that are not fee authorities', () => {
    const { feeRevenueSol } = checkFeeRevenueCeiling({
      epoch: 1021,
      merkleTrees: mockTrees([
        [
          { authority: DAO, claim: 1_000_000_000n },
          { authority: STAKER, claim: 500_000_000_000n },
        ],
      ]),
      feeAuthorities: [DAO, MARINADE],
      maxFeeRevenueSol: new Decimal(201),
    })

    expect(feeRevenueSol.toFixed(0)).toBe('1')
  })

  it('rejects a malformed fee authority instead of silently gating nothing', () => {
    expect(() =>
      checkFeeRevenueCeiling({
        epoch: 1021,
        merkleTrees: mockTrees([[{ authority: DAO, claim: 1n }]]),
        feeAuthorities: ['not-a-pubkey'],
        maxFeeRevenueSol: new Decimal(201),
      }),
    ).toThrow('Invalid fee authority public key: not-a-pubkey')
  })
})

describe('loadFeeRevenueCeiling', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'fee-revenue-ceiling-'))
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeConfig(name: string, content: string): string {
    const path = join(tmpDir, name)
    writeFileSync(path, content)
    return path
  }

  const FEE_CONFIG = `---
fee_config:
  max_fee_bps: 1600
  min_fee_bps: 200
  min_sol_revenue: 200
  marinade:
    stake_authority: BBaQsiRo744NAYaqL3nKRfgeJayoqVicEQsEnLpfsJ6x
    withdraw_authority: BBaQsiRo744NAYaqL3nKRfgeJayoqVicEQsEnLpfsJ6x
  dao:
    fee_split_share_bps: 9000
    stake_authority: mDAo14E6YJfEHcVZLcc235RVjviypmKMhftq7jeiLJz
    withdraw_authority: mDAo14E6YJfEHcVZLcc235RVjviypmKMhftq7jeiLJz
`

  it('derives the ceiling from min_sol_revenue plus the margin', () => {
    const ceiling = loadFeeRevenueCeiling({
      settlementConfig: writeConfig('config.yaml', FEE_CONFIG),
      feeRevenueMarginSol: new Decimal(1),
    })

    expect(ceiling?.maxFeeRevenueSol.toFixed(0)).toBe('201')
    expect(ceiling?.feeAuthorities).toEqual([
      'BBaQsiRo744NAYaqL3nKRfgeJayoqVicEQsEnLpfsJ6x',
      'mDAo14E6YJfEHcVZLcc235RVjviypmKMhftq7jeiLJz',
    ])
  })

  it('follows min_sol_revenue when the configured revenue target changes', () => {
    const ceiling = loadFeeRevenueCeiling({
      settlementConfig: writeConfig(
        'raised.yaml',
        FEE_CONFIG.replace('min_sol_revenue: 200', 'min_sol_revenue: 210'),
      ),
      feeRevenueMarginSol: new Decimal(1),
    })

    expect(ceiling?.maxFeeRevenueSol.toFixed(0)).toBe('211')
  })

  it('skips the check when no revenue target is configured', () => {
    const ceiling = loadFeeRevenueCeiling({
      settlementConfig: writeConfig(
        'no-revenue.yaml',
        FEE_CONFIG.replace('  min_sol_revenue: 200\n', ''),
      ),
      feeRevenueMarginSol: new Decimal(1),
    })

    expect(ceiling).toBeUndefined()
  })

  it('rejects a config without fee_config instead of gating nothing', () => {
    expect(() =>
      loadFeeRevenueCeiling({
        settlementConfig: writeConfig('empty.yaml', '---\nsettlements: []\n'),
        feeRevenueMarginSol: new Decimal(1),
      }),
    ).toThrow('No fee_config found in')
  })

  it('parses the production settlement-config.yaml', () => {
    const ceiling = loadFeeRevenueCeiling({
      settlementConfig: join(__dirname, '../../../settlement-config.yaml'),
      feeRevenueMarginSol: new Decimal(1),
    })

    expect(ceiling?.feeAuthorities).toHaveLength(2)
    expect(ceiling?.maxFeeRevenueSol.isFinite()).toBe(true)
  })
})

describe('validateMaxTotalClaims', () => {
  it.each(['NaN', 'Infinity', '-Infinity'])(
    'rejects the non-finite ceiling %s that would disable the gate',
    input => {
      expect(() => validateMaxTotalClaims(new Decimal(input))).toThrow(
        'maxTotalClaims must be a finite integer >= 1',
      )
    },
  )

  it.each(['1.5', '150000.5'])('rejects the fractional ceiling %s', input => {
    expect(() => validateMaxTotalClaims(new Decimal(input))).toThrow(
      'maxTotalClaims must be a finite integer >= 1',
    )
  })

  it.each(['0', '-1'])('rejects the below-range ceiling %s', input => {
    expect(() => validateMaxTotalClaims(new Decimal(input))).toThrow(
      'maxTotalClaims must be a finite integer >= 1',
    )
  })

  it.each(['1', '150000'])('accepts the valid ceiling %s', input => {
    expect(() => validateMaxTotalClaims(new Decimal(input))).not.toThrow()
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

describe('checkEpochHopGuardrail', () => {
  const hopThreshold = new Decimal(1.5)

  it('passes when both metrics are within threshold', () => {
    const previous = mockMetrics({
      epoch: 976,
      totalClaimAmount: 259_000_000_000n,
      avgClaimAmountPerValidator: new Decimal(25_900_000_000),
    })
    const current = mockMetrics({
      epoch: 977,
      totalClaimAmount: 320_000_000_000n, // ~23.6% jump
      avgClaimAmountPerValidator: new Decimal(32_000_000_000),
    })

    const { violations, report } = checkEpochHopGuardrail({
      currentMetrics: current,
      previousMetrics: previous,
      hopThreshold,
    })

    expect(violations).toHaveLength(0)
    expect(report).toContain('WITHIN ALLOWED HOP')
  })

  it('fails when totalClaimAmount nearly doubles (the 259 -> 457 SOL case)', () => {
    const previous = mockMetrics({
      epoch: 976,
      totalClaimAmount: 259_000_000_000n,
      avgClaimAmountPerValidator: new Decimal(25_900_000_000),
    })
    const current = mockMetrics({
      epoch: 977,
      totalClaimAmount: 457_000_000_000n,
      avgClaimAmountPerValidator: new Decimal(45_700_000_000),
    })

    const { violations, report } = checkEpochHopGuardrail({
      currentMetrics: current,
      previousMetrics: previous,
      hopThreshold,
    })

    expect(violations).toHaveLength(2)
    expect(violations.map(v => v.field)).toEqual([
      'totalClaimAmount',
      'avgClaimAmountPerValidator',
    ])
    expect(report).toContain('HOP GUARDRAIL VIOLATED')
  })

  it('fails when totalClaimAmount drops below 1/threshold', () => {
    const previous = mockMetrics({
      epoch: 976,
      totalClaimAmount: 450_000_000_000n,
      avgClaimAmountPerValidator: new Decimal(45_000_000_000),
    })
    const current = mockMetrics({
      epoch: 977,
      totalClaimAmount: 200_000_000_000n, // ratio 0.444 < 1/1.5
      avgClaimAmountPerValidator: new Decimal(20_000_000_000),
    })

    const { violations } = checkEpochHopGuardrail({
      currentMetrics: current,
      previousMetrics: previous,
      hopThreshold,
    })

    expect(violations).toHaveLength(2)
  })

  it('flags zero-baseline as violation when current is non-zero', () => {
    const previous = mockMetrics({
      epoch: 976,
      totalClaimAmount: 0n,
      avgClaimAmountPerValidator: new Decimal(0),
    })
    const current = mockMetrics({
      epoch: 977,
      totalClaimAmount: 100n,
      avgClaimAmountPerValidator: new Decimal(100),
    })

    const { violations } = checkEpochHopGuardrail({
      currentMetrics: current,
      previousMetrics: previous,
      hopThreshold,
    })

    expect(violations).toHaveLength(2)
  })

  it('passes when both epochs are zero on guarded fields', () => {
    const previous = mockMetrics({
      epoch: 976,
      totalClaimAmount: 0n,
      avgClaimAmountPerValidator: new Decimal(0),
    })
    const current = mockMetrics({
      epoch: 977,
      totalClaimAmount: 0n,
      avgClaimAmountPerValidator: new Decimal(0),
    })

    const { violations } = checkEpochHopGuardrail({
      currentMetrics: current,
      previousMetrics: previous,
      hopThreshold,
    })

    expect(violations).toHaveLength(0)
  })
})

describe('readLargeJsonFile', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sanity-check-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true })
  })

  it('parses a JSON file via streaming and returns the object', async () => {
    const data = { epoch: 100, items: [1, 2, 3], nested: { key: 'value' } }
    const filePath = join(tmpDir, 'test.json')
    writeFileSync(filePath, JSON.stringify(data))

    const result = await readLargeJsonFile(filePath)
    expect(result).toEqual(data)
  })

  it('rejects on non-existent file', async () => {
    await expect(
      readLargeJsonFile(join(tmpDir, 'missing.json')),
    ).rejects.toThrow()
  })

  it('rejects on invalid JSON', async () => {
    const filePath = join(tmpDir, 'bad.json')
    writeFileSync(filePath, '{ invalid json }')

    await expect(readLargeJsonFile(filePath)).rejects.toThrow()
  })
})
