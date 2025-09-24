/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import type { Logger } from 'pino'

export type NpmPackageData = {
  name: string
  version: string
}

export async function fetchLatestVersionInNpmRegistry(
  logger: Logger,
  npmRegistryUrl: string
): Promise<NpmPackageData> {
  try {
    const fetched = await fetch(npmRegistryUrl, {
      method: 'GET',
    })
    const fetchedJson = await fetched.json()
    const name: string = fetchedJson.name
    const versionsData: any[] = fetchedJson.versions
    const versions = Object.keys(versionsData) // ['1.0.0', 1.0.1', '1.0.2']
    const sortedVersions = versions.sort(compareVersions)
    const latestVersion = sortedVersions[sortedVersions.length - 1] || '0.0.0'
    return { name, version: latestVersion }
  } catch (err) {
    logger.debug(
      `Failed to fetch latest version from NPM registry ${npmRegistryUrl}: ${String(err)}`
    )
    return { name: '@marinade.finance/validator-bonds-...', version: '0.0.0' }
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
