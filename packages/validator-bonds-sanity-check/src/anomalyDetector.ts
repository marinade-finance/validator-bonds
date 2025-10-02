import { CONSOLE_LOG, jsonStringify } from '@marinade.finance/ts-common'
import Decimal from 'decimal.js'

import { calculateStats, detectAnomaly, emptyStats } from './stats'

import type { SettlementsDto } from './dto'
import type { Stats } from './stats'
import type { LoggerPlaceholder } from '@marinade.finance/ts-common'

interface EpochData {
  epoch: number
  totalSettlements: bigint
  totalSettlementClaimAmount: bigint
  totalSettlementClaims: bigint
  // coefficient of variation of claims count across settlements
  // trying to detect ratio of settlements with high or low claims count
  claimsCountCV: Decimal
}

function transform(dto: SettlementsDto): EpochData {
  const totalClaims = dto.settlements.reduce(
    (sum, s) => sum + s.claims_amount,
    0n,
  )
  const claimsCountStats = calculateStats(
    0,
    dto.settlements.map(s => s.claims_count),
  )
  const claimsCountCV = claimsCountStats.stdDev.div(claimsCountStats.mean)

  return {
    epoch: Number(dto.epoch),
    totalSettlements: BigInt(dto.settlements.length),
    totalSettlementClaimAmount: totalClaims,
    claimsCountCV: claimsCountCV,
    totalSettlementClaims: BigInt(
      dto.settlements.reduce((sum, s) => sum + BigInt(s.claims_count), 0n),
    ),
  }
}

export type StatsCalculation = {
  isAnomaly: boolean
  field: string
  score: Decimal
  stats: Stats
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details: any
}

export class EpochAnomalyDetector {
  private readonly scoreThreshold: Decimal
  private readonly correlationThreshold: Decimal
  private readonly logger: LoggerPlaceholder

  constructor({
    scoreThreshold,
    correlationThreshold,
    logger,
  }: {
    scoreThreshold: Decimal
    correlationThreshold: Decimal
    logger: LoggerPlaceholder
  }) {
    this.scoreThreshold = new Decimal(scoreThreshold)
    this.correlationThreshold = new Decimal(correlationThreshold)
    this.logger = logger
  }

  /**
   * Detect anomalies focusing on multivariate relationships
   */
  detectAnomalies(
    currentSettlements: SettlementsDto,
    historicalSettlements: SettlementsDto[],
  ): StatsCalculation[] {
    if (historicalSettlements.length < 3) {
      this.logger.warn(
        'Not enough historical data for reliable anomaly detection, please provide at least 3 epochs.',
      )
    }

    const currentData = transform(currentSettlements)
    const historicalData = historicalSettlements.map(transform)
    const stats: StatsCalculation[] = []

    // 0. Initial checks
    const currentDataAnomalies =
      this.detectCurrentDataAnomalies(currentSettlements)
    stats.push(...currentDataAnomalies)

    // 1. Check individual field anomalies (secondary check)
    const individualAnomalies = this.detectIndividualAnomalies(
      currentData,
      historicalData,
    )
    stats.push(...individualAnomalies)

    return stats
  }

  private detectCurrentDataAnomalies(currentSettlements: SettlementsDto) {
    const stats: StatsCalculation[] = []
    const institutionalCount = currentSettlements.settlements.length
    stats.push({
      isAnomaly: institutionalCount === 0,
      field: 'settlementsCount',
      score: Decimal(100),
      stats: emptyStats(institutionalCount),
      details: `Institutional validators ${institutionalCount} in settlement in epoch ${currentSettlements.epoch}`,
    })
    return stats
  }

  private detectIndividualAnomalies(
    currentData: EpochData,
    historicalData: EpochData[],
    fieldsToCheck: (keyof EpochData)[] = [
      'totalSettlements',
      'totalSettlementClaimAmount',
      'claimsCountCV',
    ],
  ): StatsCalculation[] {
    const calculations: StatsCalculation[] = []

    for (const field of fieldsToCheck) {
      const historicalValues = historicalData.map(d => d[field] as number)
      const currentValue = currentData[field] as number

      const stats = calculateStats(currentValue, historicalValues)

      const detectAnomalies = detectAnomaly({
        currentValue,
        historicalValues,
        field,
        correlationThreshold: this.correlationThreshold,
        scoreThreshold: this.scoreThreshold,
      })

      calculations.push({
        ...detectAnomalies,
        stats,
        details: { detectAnomaliesMethod: detectAnomalies.method },
      })
    }

    return calculations
  }
}

export function detectAnomalies({
  currentSettlements,
  historicalSettlements,
  scoreThreshold = 2.0,
  correlationThreshold = 0.15, // 15% deviation from expected ratio
  logger = CONSOLE_LOG,
}: {
  currentSettlements: SettlementsDto
  historicalSettlements: SettlementsDto[]
  scoreThreshold?: number
  correlationThreshold?: number
  logger: LoggerPlaceholder
}): { anomalyDetected: boolean; stats: StatsCalculation[]; report: string } {
  const scoreThresholdDecimal = new Decimal(scoreThreshold)
  const correlationThresholdDecimal = new Decimal(correlationThreshold)
  const detector = new EpochAnomalyDetector({
    scoreThreshold: scoreThresholdDecimal,
    correlationThreshold: correlationThresholdDecimal,
    logger,
  })
  const stats = detector.detectAnomalies(
    currentSettlements,
    historicalSettlements,
  )

  const thresholdInfo = `(correlationThreshold: ${correlationThreshold}, scoreThreshold: ${scoreThreshold})`
  const anomalyDetected = stats.some(r => r.isAnomaly)

  let report = `\n=== Epoch ${currentSettlements.epoch} Anomaly Report (historical records: ${historicalSettlements.length}) ===\n`
  report +=
    'Status: ' +
    (anomalyDetected ? '⛔ ANOMALY DETECTED' : '✅ NORMAL') +
    ` ${thresholdInfo}\n\n`

  for (const stat of stats) {
    const anomalyString = stat.isAnomaly ? '⛔' : '✅'
    report += `[${anomalyString}] Field: ${stat.field}\n`
    report += `  Score: ${stat.score.toString()}\n`
    report += `  Stats: ${jsonStringify(stat.stats)}\n`
    if (stat.details) {
      report += `  Details: ${jsonStringify(stat.details)}\n`
    }
  }
  return { anomalyDetected, stats, report }
}
