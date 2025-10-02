import { DECIMAL_ONE, DECIMAL_ZERO } from '@marinade.finance/ts-common'
import Decimal from 'decimal.js'

const MAX_DECIMAL = new Decimal(10).pow(Decimal.maxE)

export const DEFAULT_Z_SCORE_THRESHOLD = new Decimal(1.96) // 95% confidence interval

export type Stats = {
  currentValue: Decimal
  mean: Decimal
  median: Decimal
  min: Decimal
  max: Decimal
  /** Sample variance using Bessel's correction (n-1) */
  variance: Decimal
  stdDev: Decimal
  /** traditional z-score */
  zScore: Decimal
  /** standard error of the mean for t-statistic calculation */
  standardError: Decimal
  count: number
}

export function emptyStats(currentValue: number | bigint | Decimal): Stats {
  return {
    currentValue: new Decimal(currentValue.toString()),
    mean: DECIMAL_ZERO,
    median: DECIMAL_ZERO,
    min: DECIMAL_ZERO,
    max: DECIMAL_ZERO,
    variance: DECIMAL_ZERO,
    stdDev: DECIMAL_ZERO,
    zScore: DECIMAL_ZERO,
    standardError: DECIMAL_ZERO,
    count: 0,
  }
}

export function calculateStats(
  currentValue: number | bigint | Decimal,
  values: (number | bigint | Decimal)[],
): Stats {
  if (!values || !Array.isArray(values) || values.length === 0) {
    return emptyStats(currentValue)
  }
  const currentValueDecimal = new Decimal(currentValue.toString())
  const valuesDecimal = values.map(v => new Decimal(v.toString()))
  const sorted = [...valuesDecimal].sort((a, b) => a.sub(b).toNumber())

  const mean = valuesDecimal
    .reduce((sum, val) => sum.add(val), DECIMAL_ZERO)
    .div(values.length)
  const variance = valuesDecimal
    .reduce((sum, val) => sum.add(val.sub(mean).pow(2)), DECIMAL_ZERO)
    .div(values.length - 1)
  const stdDev = variance.sqrt()
  const zScore = stdDev.lte(0)
    ? MAX_DECIMAL
    : currentValueDecimal.sub(mean).div(stdDev)
  const standardError = stdDev.div(Math.sqrt(values.length))
  const min = Decimal.min(...valuesDecimal)
  const max = Decimal.max(...valuesDecimal)
  const median =
    sorted.length === 0
      ? DECIMAL_ZERO
      : sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] ?? DECIMAL_ZERO)
            .add(sorted[sorted.length / 2] ?? DECIMAL_ZERO)
            .div(2)
        : (sorted[Math.floor(sorted.length / 2)] ?? DECIMAL_ZERO)

  return {
    currentValue: currentValueDecimal,
    mean,
    median,
    min,
    max,
    variance,
    stdDev,
    zScore,
    standardError,
    count: values.length,
  }
}

export function detectAnomaly({
  currentValue,
  historicalValues,
  field,
  correlationThreshold = Decimal(0.1),
  scoreThreshold: zScoreThreshold = DEFAULT_Z_SCORE_THRESHOLD,
}: {
  currentValue: number
  historicalValues: number[]
  field: string
  correlationThreshold: Decimal
  scoreThreshold: Decimal
}): {
  isAnomaly: boolean
  score: Decimal
  field: string
  method: 'regularized-score' | 'z-score'
  criticalValue?: Decimal
} {
  const n = historicalValues.length
  const currentValueDecimal = new Decimal(currentValue.toString())
  const historicalValuesDecimal = historicalValues.map(
    v => new Decimal(v.toString()),
  )
  const stats = calculateStats(currentValueDecimal, historicalValuesDecimal)

  if (n < 15) {
    // Calculate regularization factor based on dataset size
    // small: approaches correlationThreshold * mean, large: approaches actual standard deviation
    const datasetSizeFactor = Decimal.min(
      Decimal(historicalValues.length).div(10),
      DECIMAL_ONE,
    )
    const regularizationConstant = correlationThreshold.mul(
      DECIMAL_ONE.minus(datasetSizeFactor),
    )
    const regularizedStdDev = Decimal.max(
      stats.stdDev,
      regularizationConstant.mul(stats.mean.abs()),
    )
    const score = regularizedStdDev.isZero()
      ? DECIMAL_ZERO
      : currentValueDecimal.minus(stats.mean).div(regularizedStdDev).abs()
    return {
      isAnomaly: score > zScoreThreshold,
      score,
      field: `${field}RegularizedScore`,
      method: 'regularized-score',
    }
  } else {
    // For larger datasets, use z-score
    const score = stats.zScore.abs()

    return {
      isAnomaly: score.gt(zScoreThreshold),
      score,
      field: `${field}ZScore`,
      method: 'z-score',
      criticalValue: zScoreThreshold,
    }
  }
}
