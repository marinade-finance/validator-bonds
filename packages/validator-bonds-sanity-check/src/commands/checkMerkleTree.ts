import { CliCommandError } from '@marinade.finance/cli-common'
import {
  CONSOLE_LOG,
  DECIMAL_ZERO,
  calculateDescriptiveStats,
  detectAnomaly,
  getContext,
  loadFile,
  loadFileOrDirectory,
} from '@marinade.finance/ts-common'
import Decimal from 'decimal.js'
import YAML from 'yaml'

import { parseUnifiedMerkleTree } from '../dtoMerkleTree'
import { parseSettlements } from '../dtoSettlements'

import type { UnifiedMerkleTreesDto } from '../dtoMerkleTree'
import type {
  AnomalyDetectionResult,
  DescriptiveStats,
  LoggerPlaceholder,
} from '@marinade.finance/ts-common'
import type { Command } from 'commander'

export function installCheckMerkleTree(program: Command) {
  program
    .command('check-merkle-tree')
    .description(
      'Check unified merkle trees internal consistency, cross-validate against settlement sources, and compare against historical data',
    )
    .requiredOption(
      '-m, --merkle-trees <path>',
      'Path to unified-merkle-trees.json file',
    )
    .option(
      '-s, --settlement-sources <paths...>',
      'Optional: paths to settlement source files for cross-validation (space-separated)',
    )
    .option(
      '-p, --past-merkle-trees <paths...>',
      'Optional: paths to past unified merkle tree files for historical comparison (space-separated)',
    )
    .option(
      '--correlation-threshold <threshold_ratio>',
      'Maximum allowed deviation ratio (0-1) for consistency checks with recent history. ' +
        'Lower values: more sensitive. Higher values: more tolerant.',
      d => new Decimal(d),
      new Decimal(0.15),
    )
    .option(
      '--score-threshold <threshold>',
      'Z-score threshold for flagging anomalies (how many standard deviations from mean).',
      d => new Decimal(d),
      new Decimal(2.0),
    )
    .option(
      '--min-absolute-deviation <ratio>',
      'Minimum absolute deviation from historical mean (as ratio 0-1) required to flag anomaly.',
      d => new Decimal(d),
      new Decimal(0.05),
    )
    .action(manageCheckMerkleTree)
}

export interface MerkleTreeMetrics {
  epoch: number
  totalValidators: number
  totalClaims: number
  totalClaimAmount: bigint
  avgClaimAmountPerValidator: Decimal
  avgClaimsPerValidator: Decimal
}

export type StatsCalculation = AnomalyDetectionResult & {
  description?: string
  stats?: DescriptiveStats
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details: any
}

const FIELD_DESCRIPTIONS: Record<string, string> = {
  totalValidators:
    'Number of validators with merkle trees. Represents how many validators are receiving claims.',
  totalClaims: 'Total number of individual claims across all merkle trees.',
  totalClaimAmount:
    'Sum of all claim amounts across all merkle trees (in lamports). Total SOL being distributed.',
  avgClaimAmountPerValidator:
    'Average claim amount per validator (total claims / number of validators).',
  avgClaimsPerValidator: 'Average number of claims per validator.',
}

export function extractMetrics(dto: UnifiedMerkleTreesDto): MerkleTreeMetrics {
  const totalValidators = dto.merkle_trees.length
  const totalClaims = dto.merkle_trees.reduce(
    (sum, tree) => sum + tree.tree_nodes.length,
    0,
  )
  const totalClaimAmount = dto.merkle_trees.reduce(
    (sum, tree) =>
      sum + tree.tree_nodes.reduce((treeSum, node) => treeSum + node.claim, 0n),
    0n,
  )

  return {
    epoch: dto.epoch,
    totalValidators,
    totalClaims,
    totalClaimAmount,
    avgClaimAmountPerValidator: totalValidators
      ? new Decimal(totalClaimAmount.toString())
          .div(totalValidators)
          .toDecimalPlaces(0, Decimal.ROUND_DOWN)
      : DECIMAL_ZERO,
    avgClaimsPerValidator: totalValidators
      ? new Decimal(totalClaims).div(totalValidators).toDecimalPlaces(2)
      : DECIMAL_ZERO,
  }
}

async function manageCheckMerkleTree({
  merkleTrees,
  settlementSources,
  pastMerkleTrees,
  correlationThreshold,
  scoreThreshold,
  minAbsoluteDeviation,
}: {
  merkleTrees: string
  settlementSources?: string[]
  pastMerkleTrees?: string[]
  correlationThreshold: Decimal
  scoreThreshold: Decimal
  minAbsoluteDeviation: Decimal
}) {
  const { logger } = getContext()

  // Validate thresholds
  if (correlationThreshold.lessThan(0) || correlationThreshold.greaterThan(1)) {
    throw CliCommandError.instance(
      `correlationThreshold must be between 0 and 1, got ${correlationThreshold.toString()}`,
    )
  }
  if (scoreThreshold.lessThan(0)) {
    throw CliCommandError.instance(
      `scoreThreshold must be >= 0, got ${scoreThreshold.toString()}`,
    )
  }
  if (minAbsoluteDeviation.lessThan(0) || minAbsoluteDeviation.greaterThan(1)) {
    throw CliCommandError.instance(
      `minAbsoluteDeviation must be between 0 and 1, got ${minAbsoluteDeviation.toString()}`,
    )
  }

  logger.info(`Loading merkle tree file: ${merkleTrees}`)

  const merkleTreesData = await loadFile(merkleTrees)

  // UnifiedMerkleTreesDto extends SettlementMerkleTreesDto with an optional
  // `sources` field, so it accepts both formats without a fallback try/catch.
  const merkleTreesDto = await parseUnifiedMerkleTree(
    merkleTreesData,
    merkleTrees,
  )
  const isUnifiedFormat = !!(
    merkleTreesDto.sources && merkleTreesDto.sources.length > 0
  )
  logger.info(
    `Loaded ${isUnifiedFormat ? 'unified' : 'standard'} merkle trees: epoch ${merkleTreesDto.epoch}, ` +
      `sources: ${merkleTreesDto.sources?.join(', ') || 'N/A'}, count: ${merkleTreesDto.merkle_trees.length}`,
  )

  // Check 1: Internal consistency - each tree's sum matches max_total_claim_sum
  // NOTE: totalClaimSum (Decimal) and extractMetrics' totalClaimAmount (bigint) represent
  //       the same logical value but are computed independently. Keep them in sync if changing.
  logger.info('Checking internal consistency...')
  let totalClaimSum = DECIMAL_ZERO
  let totalClaimsCount = 0
  let inconsistentTrees = 0

  for (const tree of merkleTreesDto.merkle_trees) {
    const nodeClaimSum = tree.tree_nodes.reduce(
      (sum, node) => sum.plus(new Decimal(node.claim.toString())),
      DECIMAL_ZERO,
    )

    if (
      !nodeClaimSum.equals(new Decimal(tree.max_total_claim_sum.toString()))
    ) {
      logger.error(
        `Tree for ${tree.vote_account.toBase58()}: node claims sum (${nodeClaimSum.toString()}) != max_total_claim_sum (${tree.max_total_claim_sum.toString()})`,
      )
      inconsistentTrees++
    }

    if (tree.tree_nodes.length !== tree.max_total_claims) {
      logger.error(
        `Tree for ${tree.vote_account.toBase58()}: node count (${tree.tree_nodes.length}) != max_total_claims (${tree.max_total_claims})`,
      )
      inconsistentTrees++
    }

    totalClaimSum = totalClaimSum.plus(nodeClaimSum)
    totalClaimsCount += tree.tree_nodes.length
  }

  if (inconsistentTrees > 0) {
    throw CliCommandError.instance(
      `${inconsistentTrees} merkle trees have internal inconsistencies`,
    )
  }
  logger.info(
    `✓ Internal consistency check passed for ${merkleTreesDto.merkle_trees.length} merkle trees`,
  )
  logger.info(
    `  Total validators: ${merkleTreesDto.merkle_trees.length}, Total claims: ${totalClaimsCount}, Total amount: ${totalClaimSum.toString()} lamports`,
  )

  // Basic validation: flag zero settlements as anomalous
  if (merkleTreesDto.merkle_trees.length === 0) {
    throw CliCommandError.instance(
      `Merkle tree file contains zero merkle trees for epoch ${merkleTreesDto.epoch}. ` +
        'This is likely a data generation error.',
    )
  }

  // Check 2: Cross-validate against settlement sources if provided
  if (settlementSources && settlementSources.length > 0) {
    logger.info(
      `Cross-validating against ${settlementSources.length} settlement source(s)...`,
    )

    const settlementDataWithPaths = (
      await Promise.all(
        settlementSources.map(async path => {
          const data = await loadFileOrDirectory(path)
          return data.map(d => ({ data: d, sourcePath: path }))
        }),
      )
    ).flat()

    let sourceSettlementsTotal = DECIMAL_ZERO
    let sourceClaimsCount = 0

    for (const { data, sourcePath } of settlementDataWithPaths) {
      if (!data) continue
      const settlements = await parseSettlements(data, sourcePath)

      // Verify epoch consistency between settlements and merkle trees
      if (settlements.epoch !== merkleTreesDto.epoch) {
        throw CliCommandError.instance(
          `Epoch mismatch: settlement source ${sourcePath} has epoch ${settlements.epoch.toString()}, ` +
            `but merkle trees have epoch ${merkleTreesDto.epoch.toString()}`,
        )
      }

      const sourceSum = settlements.settlements.reduce((total, settlement) => {
        const settlementSum = settlement.claims.reduce(
          (sum, claim) => sum.plus(new Decimal(claim.claim_amount.toString())),
          DECIMAL_ZERO,
        )
        return total.plus(settlementSum)
      }, DECIMAL_ZERO)

      const sourceClaims = settlements.settlements.reduce(
        (sum, s) => sum + s.claims_count,
        0,
      )

      logger.info(
        `  Source ${sourcePath}: ${sourceSum.toString()} lamports, ${sourceClaims} claims`,
      )
      sourceSettlementsTotal = sourceSettlementsTotal.plus(sourceSum)
      sourceClaimsCount += sourceClaims
    }

    logger.info(
      `  Settlement sources total: ${sourceSettlementsTotal.toString()} lamports, ${sourceClaimsCount} claims`,
    )
    logger.info(
      `  Merkle trees total: ${totalClaimSum.toString()} lamports, ${totalClaimsCount} claims`,
    )

    // Total amounts should match (claims may be merged across sources, so count can differ)
    if (!sourceSettlementsTotal.equals(totalClaimSum)) {
      throw CliCommandError.instance(
        `Mismatch in total claim amounts: Settlement sources (${sourceSettlementsTotal.toString()}) vs Merkle trees (${totalClaimSum.toString()})`,
      )
    }
    logger.info('✓ Cross-validation check passed: total amounts match')

    // Note: claim counts may differ due to merging, so we only warn if very different
    if (
      Math.abs(sourceClaimsCount - totalClaimsCount) >
      sourceClaimsCount * 0.5
    ) {
      logger.warn(
        `Large difference in claim counts: sources (${sourceClaimsCount}) vs merkle trees (${totalClaimsCount}). This may be expected due to claim merging.`,
      )
    }
  }

  // Check 3: Historical comparison with heuristics
  if (pastMerkleTrees && pastMerkleTrees.length > 0) {
    logger.info(
      `Comparing against ${pastMerkleTrees.length} historical merkle tree file(s)...`,
    )

    const pastDataWithPaths = (
      await Promise.all(
        pastMerkleTrees.map(async path => {
          const data = await loadFileOrDirectory(path)
          return data.map(d => ({ data: d, sourcePath: path }))
        }),
      )
    ).flat()

    const historicalDtos: UnifiedMerkleTreesDto[] = []
    for (const { data, sourcePath: pastPath } of pastDataWithPaths) {
      if (!data) continue
      const dto = await parseUnifiedMerkleTree(data, pastPath)
      historicalDtos.push(dto)
    }

    const currentMetrics = extractMetrics(merkleTreesDto)
    const historicalMetrics = historicalDtos.map(extractMetrics)

    const { anomalyDetected, report } = reportMerkleTreeAnomalies({
      currentMetrics,
      historicalMetrics,
      logger,
      correlationThreshold,
      scoreThreshold,
      minAbsoluteDeviationRatio: minAbsoluteDeviation,
    })

    if (anomalyDetected) {
      logger.warn(report)
      throw CliCommandError.instance(
        'Historical anomalies detected in merkle trees!',
      )
    } else {
      logger.info(report)
    }
  }

  // Summary
  logger.info('\n=== Summary ===')
  logger.info(`Epoch: ${merkleTreesDto.epoch}`)
  logger.info(`Format: ${isUnifiedFormat ? 'Unified' : 'Standard'}`)
  if (isUnifiedFormat && merkleTreesDto.sources) {
    logger.info(`Sources: ${merkleTreesDto.sources.join(', ')}`)
  }
  logger.info(`Total merkle trees: ${merkleTreesDto.merkle_trees.length}`)
  logger.info(`Total claims: ${totalClaimsCount}`)
  logger.info(`Total claim amount: ${totalClaimSum.toString()} lamports`)
  logger.info('✓ All checks passed')
}

export function reportMerkleTreeAnomalies({
  currentMetrics,
  historicalMetrics,
  logger = CONSOLE_LOG,
  correlationThreshold,
  scoreThreshold,
  minAbsoluteDeviationRatio,
}: {
  currentMetrics: MerkleTreeMetrics
  historicalMetrics: MerkleTreeMetrics[]
  logger: LoggerPlaceholder
  correlationThreshold: Decimal
  scoreThreshold: Decimal
  minAbsoluteDeviationRatio: Decimal
}): { anomalyDetected: boolean; stats: StatsCalculation[]; report: string } {
  if (historicalMetrics.length < 3) {
    throw CliCommandError.instance(
      'Not enough historical data for reliable anomaly detection, please provide at least 3 epochs.',
    )
  }

  const fieldsToCheck: (keyof MerkleTreeMetrics)[] = [
    'totalValidators',
    'totalClaims',
    'totalClaimAmount',
    'avgClaimAmountPerValidator',
  ]

  const stats: StatsCalculation[] = []

  for (const field of fieldsToCheck) {
    const currentValue = Number(String(currentMetrics[field]))
    const historicalValues = historicalMetrics.map(m =>
      Number(String(m[field])),
    )

    const anomaly = detectIndividualAnomaly({
      currentValue,
      historicalValues,
      field: `${field}:`,
      description: FIELD_DESCRIPTIONS[field],
      correlationThreshold,
      scoreThreshold,
      minAbsoluteDeviationRatio,
      logger,
    })
    stats.push(anomaly)
  }

  const thresholdInfo =
    `(correlationThreshold: ${correlationThreshold.toString()}, ` +
    `scoreThreshold: ${scoreThreshold.toString()}, ` +
    `minAbsoluteDeviation: ${minAbsoluteDeviationRatio.mul(100).toString()}%)`
  const anomalyDetected = stats.some(r => r.isAnomaly)

  let report = `\n=== Epoch ${currentMetrics.epoch} Merkle Tree Anomaly Report (historical records: ${historicalMetrics.length}) ===\n`
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

export function detectIndividualAnomaly({
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
  if (logger) {
    logger.debug(
      `Analyzing field: ${field}, current value: ${currentValue}, ` +
        `historical values: ${JSON.stringify(historicalValues)}`,
    )
  }

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

  // Check similarity to the N most recent epochs
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
  // Also skip if similar to all recent epochs
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
