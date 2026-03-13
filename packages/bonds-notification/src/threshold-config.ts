import * as path from 'path'

import { parseAndValidateYaml } from '@marinade.finance/cli-common'
import { loadFileSync } from '@marinade.finance/ts-common'

import { ThresholdConfigDto } from './threshold-config-dto'

import type { ThresholdConfig } from './types'

let cachedConfig: ThresholdConfig | null = null

export async function loadThresholdConfig(): Promise<ThresholdConfig> {
  if (cachedConfig) return cachedConfig

  const configPath = path.resolve(__dirname, 'config', 'thresholds.yaml')
  const raw = loadFileSync(configPath)
  const parsed = await parseAndValidateYaml(raw, ThresholdConfigDto)
  cachedConfig = parsed as ThresholdConfig
  return cachedConfig
}

/** Reset cached config (for testing) */
export function resetThresholdConfigCache(): void {
  cachedConfig = null
}
