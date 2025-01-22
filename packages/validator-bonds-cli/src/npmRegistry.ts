/* eslint-disable @typescript-eslint/no-explicit-any */

import { Logger } from 'pino'

export const VALIDATOR_BONDS_NPM_URL =
  'https://registry.npmjs.org/@marinade.finance/validator-bonds-cli'

export async function fetchLatestVersionInNpmRegistry(
  logger: Logger,
  npmRegistryUrl: string = VALIDATOR_BONDS_NPM_URL,
): Promise<string> {
  try {
    const fetched = await fetch(npmRegistryUrl, {
      method: 'GET',
    })
    const fetchedJson = await fetched.json()
    const versionsData: any[] = (fetchedJson as any).versions
    const versions = Object.keys(versionsData) // ['1.0.0', 1.0.1', '1.0.2']
    const sortedVersions = versions.sort(compareVersions)
    const latestVersion = sortedVersions[sortedVersions.length - 1]
    return latestVersion
  } catch (err) {
    logger.debug(
      `Failed to fetch latest version from NPM registry ${npmRegistryUrl}: ${err}`,
    )
    return '0.0.0'
  }
}

export function compareVersions(a: string, b: string): number {
  const parseVersion = (version: string) =>
    version
      .split('.')
      .map(part => (isNaN(parseInt(part)) ? part : parseInt(part)))

  const aParts = parseVersion(a)
  const bParts = parseVersion(b)

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aPart = aParts[i] ?? 0
    const bPart = bParts[i] ?? 0

    if (typeof aPart === 'number' && typeof bPart === 'number') {
      if (aPart !== bPart) {
        return aPart - bPart
      }
    } else {
      const aPartString = aPart.toString()
      const bPartString = bPart.toString()
      if (aPartString !== bPartString) {
        return aPartString.localeCompare(bPartString)
      }
    }
  }

  return 0
}
