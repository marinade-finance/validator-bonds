import { CliCommandError } from '@marinade.finance/cli-common'
import { loadFileOrDirectory } from '@marinade.finance/ts-common'
import { Option } from 'commander'

import { detectAnomalies } from '../anomalyDetector'
import { getCliContext } from '../context'
import { parseSettlements } from '../dto'

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
      '-p, --past <paths...>',
      'Input files or directory paths (can be used multiple times, space-separated)',
    )
    .option(
      '--correlation-threshold <threshold_percent>',
      'Maximum correlation deviation threshold (0-100%) for relationship anomaly detection',
      parseFloat,
      15.0,
    )
    .option(
      '--score-threshold <threshold>',
      'Maximum acceptable z-score for individual field anomaly detection. ' +
        'Z-score threshold for flagging anomalies (how many standard deviations from mean). ' +
        'Typical range: 1.5 (sensitive) to 3.0 (strict). Default 2.0 catches ~5% as anomalies.',
      parseFloat,
      2.0,
    )
    .addOption(
      new Option('-t, --type <type>', 'Type of processing to perform')
        .choices(Object.values(ProcessingType))
        .default(ProcessingType.BID),
    )
    .action(
      async ({
        past,
        correlationThreshold,
        scoreThreshold,
        type,
      }: {
        past: string[]
        correlationThreshold: number
        scoreThreshold: number
        type: ProcessingType
      }) => {
        await manageCheck({
          pastPaths: past,
          correlationThreshold,
          scoreThreshold,
          type,
        })
      },
    )
}

async function manageCheck({
  pastPaths,
  correlationThreshold,
  scoreThreshold,
  type,
}: {
  pastPaths: string[]
  correlationThreshold: number
  scoreThreshold: number
  type: ProcessingType
}) {
  const { logger, currentData, currentPath } = getCliContext()

  if (correlationThreshold < 0 || correlationThreshold > 100) {
    throw CliCommandError.instance(
      `Correlation threshold percentage (${correlationThreshold}) must be between 0 and 100`,
    )
  }
  if (scoreThreshold < 0) {
    throw CliCommandError.instance(
      `Score threshold (${scoreThreshold}) must be a non-negative number`,
    )
  }
  // convert percentage to a ratio
  const correlationThresholdRatio = correlationThreshold / 100

  const pastData = (
    await Promise.all(pastPaths.map(path => loadFileOrDirectory(path)))
  ).flat()
  logger.debug(
    `Successfully loaded current data (${currentPath}) and past data files (${pastPaths.join(', ')})`,
  )

  const currentSettlements = await parseSettlements(currentData, currentPath)
  const historicalSettlements = await Promise.all(
    pastData.map(async (data, index) =>
      parseSettlements(data, pastPaths[index]),
    ),
  )

  logger.info('Starting anomaly detection...')

  const { anomalyDetected, report } = detectAnomalies({
    currentSettlements,
    historicalSettlements,
    type,
    logger,
    correlationThreshold: correlationThresholdRatio,
    scoreThreshold,
  })

  if (anomalyDetected) {
    logger.warn(report)
    throw CliCommandError.instance('Anomalies detected!')
  } else {
    logger.info(report)
  }
}
