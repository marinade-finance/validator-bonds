import { CliCommandError } from '@marinade.finance/cli-common'
import {
  CONSOLE_LOG,
  DECIMAL_ZERO,
  calculateDescriptiveStats,
  detectAnomaly,
  jsonStringify,
  logDebug,
} from '@marinade.finance/ts-common'
import Decimal from 'decimal.js'
import YAML from 'yaml'

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
  // grouped by the settlement reason
  claimsCountCV?: Map<string, Decimal>
}

function transform(dto: SettlementsDto): EpochData {
  const totalClaims = dto.settlements.reduce(
    (sum, s) => sum + s.claims_amount,
    0n,
  )
  const claimsCountGrouped = dto.settlements
    // filtering out penalty settlements, those are expected to have different claims count behavior
    .filter(
      settlement =>
        !settlement.reason.simpleReason
          ?.toLocaleLowerCase()
          .includes('penalty'),
    )
    .reduce((acc, settlement) => {
      const reason = settlement.reason.simpleReason ?? 'unknown'
      const counts = acc.get(reason) ?? []
      counts.push(settlement.claims_count)
      acc.set(reason, counts)
      return acc
    }, new Map<string, number[]>())
  const claimsCountCVGrouped = new Map(
    Array.from(claimsCountGrouped, ([reason, counts]) => {
      const stats = calculateDescriptiveStats(counts)
      return [reason, stats.stdDev.div(stats.mean)]
    }),
  )

  return {
    epoch: Number(dto.epoch),
    totalSettlements: BigInt(dto.settlements.length),
    totalSettlementClaimAmount: totalClaims,
    claimsCountCV: claimsCountCVGrouped,
    totalSettlementClaims: BigInt(
      dto.settlements.reduce((sum, s) => sum + BigInt(s.claims_count), 0n),
    ),
    avgSettlementClaimAmountPerValidator: dto.settlements.length
      ? new Decimal(totalClaims.toString())
          .div(dto.settlements.length)
          .toDecimalPlaces(0, Decimal.ROUND_DOWN)
      : DECIMAL_ZERO,
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
    throw CliCommandError.instance(
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
      processingFields = ['totalSettlements', 'totalSettlementClaimAmount']
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
    const rawCurrentValue = currentData[field]

    const mapValue =
      rawCurrentValue instanceof Map
        ? rawCurrentValue
        : new Map([[String(field), rawCurrentValue]])

    for (const [key, value] of mapValue.entries()) {
      const currentValue = Number(String(value))
      const historicalValues = historicalData.map(d => {
        const fieldValue = d[field]
        const map =
          fieldValue instanceof Map
            ? fieldValue
            : new Map([[String(field), fieldValue]])
        return Number(String(map.get(key) ?? DECIMAL_ZERO))
      })

      const anomaly = detectIndividualAnomaly({
        currentValue,
        historicalValues,
        field:
          rawCurrentValue instanceof Map ? `${field}_${key}:` : `${field}:`,
        correlationThreshold,
        scoreThreshold,
        logger,
      })
      calculations.push(anomaly)
    }
  }

  return calculations
}

function detectIndividualAnomaly({
  currentValue,
  historicalValues,
  field,
  scoreThreshold,
  correlationThreshold,
  logger,
}: {
  currentValue: number
  historicalValues: number[]
  field: string
  scoreThreshold: Decimal
  correlationThreshold: Decimal
  logger?: LoggerPlaceholder
}): StatsCalculation {
  logDebug(
    logger,
    `Analyzing field: ${field}, current value: ${currentValue}, ` +
      `historical values: ${jsonStringify(historicalValues)}`,
  )
  const stats = calculateDescriptiveStats(historicalValues)

  const detectAnomalyData = detectAnomaly({
    currentValue,
    historicalValues,
    field,
    correlationThreshold,
    scoreThreshold,
  })

  return {
    ...detectAnomalyData,
    stats,
    details: undefined,
  }
}

export function reportAnomalies({
  currentSettlements,
  historicalSettlements,
  type,
  scoreThreshold = new Decimal('2.0'), // working with z-score like threshold
  correlationThreshold = new Decimal('0.15'), // working with percentage ratio
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
    report += `  Value: ${stat.currentValue.toString()}\n`
    report += `  Score: ${stat.score.toString()}\n`
    report += `  ${YAML.stringify({ Stats: stat.stats }, { indent: 4 })}\n`
    if (stat.details) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      report += `  ${YAML.stringify({ Details: stat.details }, { indent: 4 })}\n`
    }
  }
  return { anomalyDetected, stats, report }
}
