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
  description?: string
  stats?: DescriptiveStats
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details: any
}

// Field descriptions for report output
const FIELD_DESCRIPTIONS: Record<string, string> = {
  settlementsCount:
    'Number of settlements in current epoch data (basic validation check)',
  totalSettlements:
    'Number of settlements (one per validator with claims). Reflects how many validators are receiving distribution rewards.',
  totalSettlementClaimAmount:
    'Sum of all claim amounts across all settlements (in lamports). Represents the total SOL being distributed to validators.',
  avgSettlementClaimAmountPerValidator:
    'Average claim amount per validator (total claims / number of settlements). PSR compensates validators for missed rewards due to stake account issues.',
}

// Default minimum absolute deviation ratio (5%) - requires both statistical
// significance (z-score) AND practical significance (absolute change) to flag anomaly.
// Higher than institutional (1%) because settlement counts are more volatile.
const DEFAULT_MIN_ABSOLUTE_DEVIATION_RATIO = new Decimal(0.05)

function detectAnomalies({
  currentSettlements,
  historicalSettlements,
  type,
  scoreThreshold,
  correlationThreshold,
  minAbsoluteDeviationRatio = DEFAULT_MIN_ABSOLUTE_DEVIATION_RATIO,
  logger,
}: {
  currentSettlements: SettlementsDto
  historicalSettlements: SettlementsDto[]
  type: ProcessingType
  // z-score threshold (e.g., 2.0 means 2 standard deviations from mean)
  scoreThreshold: Decimal
  // talking in percent ratio, e.g. 0.15 = 15%
  correlationThreshold: Decimal
  // minimum absolute deviation from mean (as ratio) required to flag anomaly
  minAbsoluteDeviationRatio?: Decimal
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
      // PSR data is inherently sparse and volatile (often 1-2 settlements per epoch).
      // Only check avgSettlementClaimAmountPerValidator, not totalSettlements count.
      processingFields = ['avgSettlementClaimAmountPerValidator']
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
    minAbsoluteDeviationRatio,
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
    description: FIELD_DESCRIPTIONS['settlementsCount'],
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
  minAbsoluteDeviationRatio,
  logger,
}: {
  currentData: EpochData
  historicalData: EpochData[]
  fieldsToCheck: (keyof EpochData)[]
  scoreThreshold: Decimal
  correlationThreshold: Decimal
  minAbsoluteDeviationRatio: Decimal
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

      const fieldName =
        rawCurrentValue instanceof Map ? `${field}_${key}:` : `${field}:`
      const anomaly = detectIndividualAnomaly({
        currentValue,
        historicalValues,
        field: fieldName,
        description: FIELD_DESCRIPTIONS[field],
        correlationThreshold,
        scoreThreshold,
        minAbsoluteDeviationRatio,
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
  description,
  scoreThreshold,
  correlationThreshold,
  minAbsoluteDeviationRatio,
  logger,
}: {
  currentValue: number
  historicalValues: number[]
  field: string
  description?: string
  scoreThreshold: Decimal
  correlationThreshold: Decimal
  minAbsoluteDeviationRatio: Decimal
  logger?: LoggerPlaceholder
}): StatsCalculation {
  logDebug(
    logger,
    `Analyzing field: ${field}, current value: ${currentValue}, ` +
      `historical values: ${jsonStringify(historicalValues)}`,
  )
  const stats = calculateDescriptiveStats(historicalValues)
  const currentValueDecimal = new Decimal(currentValue)

  const anomalyResult = detectAnomaly({
    currentValue,
    historicalValues,
    field,
    correlationThreshold,
    scoreThreshold,
  })

  // Calculate absolute deviation ratio from historical mean
  const absoluteDeviationRatio = stats.mean.abs().isZero()
    ? DECIMAL_ZERO
    : currentValueDecimal.sub(stats.mean).abs().div(stats.mean.abs())

  // Check similarity to the N most recent epochs (more defensive than single epoch).
  // Requires current value to be similar to ALL of the N most recent epochs to auto-pass.
  // This prevents a single outlier from immediately approving subsequent similar values.
  const recentEpochsToCheck = 2
  const recentValues = historicalValues.slice(-recentEpochsToCheck)

  const isSimilarToRecent = (value: number): boolean => {
    const valueDecimal = new Decimal(value.toString())
    if (valueDecimal.isZero()) return false
    const deviation = currentValueDecimal
      .sub(valueDecimal)
      .abs()
      .div(valueDecimal.abs())
    return deviation.lte(correlationThreshold)
  }

  // Must be similar to ALL of the recent epochs (not just one)
  const similarToAllRecent =
    recentValues.length >= recentEpochsToCheck &&
    recentValues.every(v => isSimilarToRecent(v))

  // Also check min-max range for reporting
  const tolerance = correlationThreshold.mul(stats.max)
  const isWithinHistoricalRange =
    currentValueDecimal.gte(stats.min.sub(tolerance)) &&
    currentValueDecimal.lte(stats.max.add(tolerance))

  // Require BOTH statistical significance (z-score) AND practical significance (absolute deviation)
  // Also skip if similar to all recent epochs (already approved similar values)
  const meetsAbsoluteThreshold = absoluteDeviationRatio.gte(
    minAbsoluteDeviationRatio,
  )
  const isAnomaly =
    anomalyResult.isAnomaly && meetsAbsoluteThreshold && !similarToAllRecent

  return {
    ...anomalyResult,
    isAnomaly,
    description,
    stats,
    details: {
      absoluteDeviationRatio: absoluteDeviationRatio.mul(100).toFixed(2) + '%',
      minAbsoluteDeviationRequired:
        minAbsoluteDeviationRatio.mul(100).toFixed(2) + '%',
      meetsAbsoluteThreshold,
      recentEpochsToCheck,
      recentValues: recentValues.map(v => v.toString()),
      similarToAllRecent,
      historicalMin: stats.min.toString(),
      historicalMax: stats.max.toString(),
      toleranceApplied: tolerance.toString(),
      isWithinHistoricalRange,
    },
  }
}

export function reportAnomalies({
  currentSettlements,
  historicalSettlements,
  type,
  scoreThreshold = new Decimal('2.0'), // working with z-score like threshold
  correlationThreshold = new Decimal('0.15'), // working with percentage ratio
  minAbsoluteDeviationRatio = DEFAULT_MIN_ABSOLUTE_DEVIATION_RATIO,
  logger = CONSOLE_LOG,
}: {
  currentSettlements: SettlementsDto
  historicalSettlements: SettlementsDto[]
  type: ProcessingType
  scoreThreshold?: Decimal
  correlationThreshold?: Decimal
  minAbsoluteDeviationRatio?: Decimal
  logger: LoggerPlaceholder
}): { anomalyDetected: boolean; stats: StatsCalculation[]; report: string } {
  const stats = detectAnomalies({
    currentSettlements,
    historicalSettlements,
    type,
    scoreThreshold,
    correlationThreshold,
    minAbsoluteDeviationRatio,
    logger,
  })

  const thresholdInfo =
    `(correlationThreshold: ${correlationThreshold.toString()}, ` +
    `scoreThreshold: ${scoreThreshold.toString()}, ` +
    `minAbsoluteDeviation: ${minAbsoluteDeviationRatio.mul(100).toString()}%)`
  const anomalyDetected = stats.some(r => r.isAnomaly)

  let report = `\n=== Epoch ${currentSettlements.epoch} Anomaly Report (historical records: ${historicalSettlements.length}) ===\n`
  report +=
    'Status: ' +
    (anomalyDetected ? '⛔ ANOMALY DETECTED' : '✅ NORMAL') +
    ` ${thresholdInfo}\n\n`

  for (const stat of stats) {
    const anomalyString = stat.isAnomaly ? '⛔' : '✅'
    report += `[${anomalyString}] Field: ${stat.field}\n`
    if (stat.description) {
      report += `  Description: ${stat.description}\n`
    }
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
