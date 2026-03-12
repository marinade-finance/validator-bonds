import * as fs from 'fs'
import * as path from 'path'

import * as yaml from 'js-yaml'

import type { ThresholdConfig } from './types'

let cachedConfig: ThresholdConfig | null = null

export function loadThresholdConfig(): ThresholdConfig {
  if (cachedConfig) return cachedConfig

  const configPath = path.resolve(__dirname, 'config', 'thresholds.yaml')
  const raw = fs.readFileSync(configPath, 'utf8')
  const parsed = yaml.load(raw) as ThresholdConfig
  cachedConfig = parsed
  return parsed
}

/** Reset cached config (for testing) */
export function resetThresholdConfigCache(): void {
  cachedConfig = null
}
