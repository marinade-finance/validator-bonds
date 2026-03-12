import {
  DsSamSDK,
  type DsSamConfig,
  type AuctionResult,
  type AuctionValidator,
  InputsSource,
} from '@marinade.finance/ds-sam-sdk'

import type { EventingConfig } from './types'
import type { LoggerWrapper } from '@marinade.finance/ts-common'

export async function runAuction(
  config: EventingConfig,
  logger: LoggerWrapper,
): Promise<{
  validators: AuctionValidator[]
  epoch: number
  winningTotalPmpe: number
}> {
  const sdkConfig: Partial<DsSamConfig> = {
    bondsApiBaseUrl: config.bondsApiUrl,
    validatorsApiBaseUrl: config.validatorsApiUrl,
    scoringApiBaseUrl: config.scoringApiUrl,
    tvlInfoApiBaseUrl: config.tvlApiUrl,
  }

  if (config.cacheInputs) {
    sdkConfig.inputsSource = InputsSource.APIS
    sdkConfig.cacheInputs = true
    sdkConfig.inputsCacheDirPath = config.cacheInputs
  }

  logger.info('Running auction simulation via DsSamSDK...')
  const sdk = new DsSamSDK(sdkConfig)
  const result: AuctionResult = await sdk.run()

  const validators = result.auctionData.validators
  const epoch = result.auctionData.epoch

  logger.info(
    `Auction simulation complete: ${validators.length} validators, epoch ${epoch}, winningPmpe=${result.winningTotalPmpe}`,
  )

  return {
    validators,
    epoch,
    winningTotalPmpe: result.winningTotalPmpe,
  }
}
