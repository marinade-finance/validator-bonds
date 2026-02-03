import { CliCommandError } from '@marinade.finance/cli-common'
import {
  getContext,
  loadFile,
  loadFileOrDirectory,
} from '@marinade.finance/ts-common'
import { Option } from 'commander'
import Decimal from 'decimal.js'

import { reportAnomalies } from '../anomalyDetector'
import { parseSettlements } from '../dtoSettlements'

import type { Command } from 'commander'

export enum ProcessingType {
  PSR = 'psr',
  BID = 'bid',
}

export function installCheck(program: Command) {
  program
    .command('check')
    .description('Check Bonds Settlements data from past and the current epoch')
    .requiredOption(
      '-c, --current <path>',
      'Input file of validator bonds settlement (JSON)',
    )
    .requiredOption(
      '-p, --past <paths...>',
      'Input files or directory paths (can be used multiple times, space-separated)',
    )
    .option(
      '--correlation-threshold <threshold_ratio>',
      'Maximum allowed deviation ratio (0-1) for consistency checks with recent history. ' +
        'Used to determine if current value is "close enough" to the 2 most recent epochs. ' +
        'Lower values (e.g., 0.10): more sensitive, more human interventions required. ' +
        'Higher values (e.g., 0.20): more tolerant, fewer interventions.',
      d => new Decimal(d),
      Decimal(0.15),
    )
    .option(
      '--score-threshold <threshold>',
      'Z-score threshold for flagging anomalies (how many standard deviations from mean). ' +
        'Calculates z-score: (current - mean) / stdDev. ' +
        'Lower values (e.g., 1.5): more sensitive, catches ~87% of normal data. ' +
        'Higher values (e.g., 3.0): stricter, only flags ~0.3% as anomalies.',
      d => new Decimal(d),
      Decimal(2.0),
    )
    .option(
      '--min-absolute-deviation <ratio>',
      'Minimum absolute deviation from historical mean (as ratio 0-1) required to flag anomaly. ' +
        'E.g., 0.05 means current value must differ by at least 5% from mean. ' +
        'Even if z-score exceeds threshold, anomaly is only flagged if absolute deviation also exceeds this. ' +
        'Prevents flagging tiny changes that only appear significant due to low variance.',
      d => new Decimal(d),
      Decimal(0.05),
    )
    .addOption(
      new Option(
        '-t, --type <type>',
        'Type of processing: "bid" checks totalSettlements and totalSettlementClaimAmount; ' +
          '"psr" checks only avgSettlementClaimAmountPerValidator (settlement counts too volatile).',
      )
        .choices(Object.values(ProcessingType))
        .default(ProcessingType.BID),
    )
    .action(manageCheck)
}

async function manageCheck({
  current,
  past,
  correlationThreshold,
  scoreThreshold,
  minAbsoluteDeviation,
  type,
}: {
  current: string
  past: string[]
  correlationThreshold: Decimal
  scoreThreshold: Decimal
  minAbsoluteDeviation: Decimal
  type: ProcessingType
}) {
  const { logger } = getContext()

  if (correlationThreshold.lt(0) || correlationThreshold.gt(1)) {
    throw CliCommandError.instance(
      `Correlation threshold ratio (${correlationThreshold.toString()}) must be between 0 and 1`,
    )
  }
  if (scoreThreshold.lt(0)) {
    throw CliCommandError.instance(
      `Score threshold (${scoreThreshold.toString()}) must be a non-negative number`,
    )
  }
  if (minAbsoluteDeviation.lt(0) || minAbsoluteDeviation.gt(1)) {
    throw CliCommandError.instance(
      `Minimum absolute deviation ratio (${minAbsoluteDeviation.toString()}) must be between 0 and 1`,
    )
  }

  const currentData = await loadFile(current)

  const pastData = (
    await Promise.all(past.map(path => loadFileOrDirectory(path)))
  ).flat()
  logger.debug(
    `Successfully loaded current data (${current}) and past data files (${past.join(', ')})`,
  )

  const currentSettlements = await parseSettlements(currentData, current)
  const historicalSettlements = await Promise.all(
    pastData.map(async (data, index) => parseSettlements(data, past[index])),
  )

  logger.info('Starting anomaly detection...')

  const { anomalyDetected, report } = reportAnomalies({
    currentSettlements,
    historicalSettlements,
    type,
    logger,
    correlationThreshold: new Decimal(correlationThreshold),
    scoreThreshold: new Decimal(scoreThreshold),
    minAbsoluteDeviationRatio: new Decimal(minAbsoluteDeviation),
  })

  if (anomalyDetected) {
    logger.warn(report)
    throw CliCommandError.instance('Anomalies detected in Validator Bonds!')
  } else {
    logger.info(report)
  }
}
