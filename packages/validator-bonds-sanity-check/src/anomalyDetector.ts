import {
  CONSOLE_LOG,
  calculateDescriptiveStats,
  detectAnomaly,
  jsonStringify,
  logDebug,
  logWarn,
} from '@marinade.finance/ts-common'
import Decimal from 'decimal.js'

import { ProcessingType } from './commands/check'

import type { SettlementsDto } from './dtoSettlements'
import type {
  AnomalyDetectionResult,
  DescriptiveStats,
  LoggerPlaceholder,
} from '@marinade.finance/ts-common'

interface EpochData {
  epoch: number
  totalSettlements: bigint
  totalSettlementClaimAmount: bigint
  totalSettlementClaims: bigint
  avgSettlementClaimAmountPerValidator: Decimal
  // coefficient of variation of claims count across settlements
  // trying to detect ratio of settlements with high or low claims count
  claimsCountCV: Decimal
}

function transform(dto: SettlementsDto): EpochData {
  const totalClaims = dto.settlements.reduce(
    (sum, s) => sum + s.claims_amount,
    0n,
  )
  const claimsCountStats = calculateDescriptiveStats(
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
    avgSettlementClaimAmountPerValidator: dto.settlements.length
      ? new Decimal(totalClaims.toString())
          .div(dto.settlements.length)
          .toDecimalPlaces(0, Decimal.ROUND_DOWN)
      : new Decimal(0),
  }
}

export type StatsCalculation = AnomalyDetectionResult & {
  stats?: DescriptiveStats
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details: any
}

function detectAnomalies({
  currentSettlements,
  historicalSettlements,
  type,
  scoreThreshold,
  correlationThreshold,
  logger,
}: {
  currentSettlements: SettlementsDto
  historicalSettlements: SettlementsDto[]
  type: ProcessingType
  // z-score threshold (e.g., 2.0 means 2 standard deviations from mean)
  scoreThreshold: Decimal
  // talking in percent ratio, e.g. 0.15 = 15%
  correlationThreshold: Decimal
  logger?: LoggerPlaceholder
}): StatsCalculation[] {
  if (historicalSettlements.length < 3) {
    logWarn(
      logger,
      'Not enough historical data for reliable anomaly detection, please provide at least 3 epochs.',
    )
  }

  const currentData = transform(currentSettlements)
  const historicalData = historicalSettlements.map(transform)
  const stats: StatsCalculation[] = []

  // 0. Initial checks
  const currentDataAnomalies = detectCurrentDataAnomalies(currentSettlements)
  stats.push(...currentDataAnomalies)

  let processingFields: (keyof EpochData)[] = []
  switch (type) {
    case ProcessingType.BID: {
      processingFields = [
        'totalSettlements',
        'totalSettlementClaimAmount',
        'claimsCountCV',
      ]
      break
    }
    case ProcessingType.PSR: {
      processingFields = [
        'totalSettlements',
        'avgSettlementClaimAmountPerValidator',
      ]
      break
    }
  }

  // 1. Check individual field anomalies (secondary check)
  const individualAnomalies = detectIndividualAnomalies({
    currentData,
    historicalData,
    fieldsToCheck: processingFields,
    scoreThreshold,
    correlationThreshold,
    logger,
  })
  stats.push(...individualAnomalies)

  return stats
}

function detectCurrentDataAnomalies(currentSettlements: SettlementsDto) {
  const stats: StatsCalculation[] = []
  const institutionalCount = Decimal(currentSettlements.settlements.length)
  stats.push({
    isAnomaly: institutionalCount.eq(0),
    field: 'settlementsCount',
    currentValue: institutionalCount,
    score: Decimal(100),
    details:
      `Institutional validators ${institutionalCount.toString()} ` +
      `in settlement in epoch ${currentSettlements.epoch}`,
  })
  return stats
}

function detectIndividualAnomalies({
  currentData,
  historicalData,
  fieldsToCheck,
  scoreThreshold,
  correlationThreshold,
  logger,
}: {
  currentData: EpochData
  historicalData: EpochData[]
  fieldsToCheck: (keyof EpochData)[]
  scoreThreshold: Decimal
  correlationThreshold: Decimal
  logger?: LoggerPlaceholder
}): StatsCalculation[] {
  const calculations: StatsCalculation[] = []

  for (const field of fieldsToCheck) {
    const historicalValues = historicalData.map(d => d[field] as number)
    const currentValue = currentData[field] as number

    logDebug(
      logger,
      `Analyzing field: ${field}, current value: ${currentValue}, ` +
        `historical values: ${jsonStringify(historicalValues)}`,
    )
    const stats = calculateDescriptiveStats(historicalValues)

    const detectAnomalies = detectAnomaly({
      currentValue,
      historicalValues,
      field,
      correlationThreshold,
      scoreThreshold,
    })

    calculations.push({
      ...detectAnomalies,
      stats,
      details: undefined,
    })
  }

  return calculations
}

export function reportAnomalies({
  currentSettlements,
  historicalSettlements,
  type,
  scoreThreshold = new Decimal(2.0), // working with z-score like threshold
  correlationThreshold = new Decimal(0.15), // working with percentage ratio
  logger = CONSOLE_LOG,
}: {
  currentSettlements: SettlementsDto
  historicalSettlements: SettlementsDto[]
  type: ProcessingType
  scoreThreshold?: Decimal
  correlationThreshold?: Decimal
  logger: LoggerPlaceholder
}): { anomalyDetected: boolean; stats: StatsCalculation[]; report: string } {
  const stats = detectAnomalies({
    currentSettlements,
    historicalSettlements,
    type,
    scoreThreshold,
    correlationThreshold,
    logger,
  })

  const thresholdInfo = `(correlationThreshold: ${correlationThreshold.toString()}, scoreThreshold: ${scoreThreshold.toString()})`
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
