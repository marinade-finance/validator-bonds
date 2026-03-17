/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { waitFor } from '@marinade.finance/ts-common'

import type { Logger } from 'pino'

export type NpmPackageData = {
  name: string
  version: string
}

const NPM_REGISTRY_FETCH_TIMEOUT_MS = 1000

export async function fetchLatestVersionInNpmRegistry(
  logger: Logger,
  npmRegistryUrl: string,
): Promise<NpmPackageData> {
  try {
    const fetchPromise = fetch(npmRegistryUrl, {
      method: 'GET',
    })
    const timeoutPromise = waitFor(NPM_REGISTRY_FETCH_TIMEOUT_MS).then(
      () => null,
    )
    const fetched = await Promise.race([fetchPromise, timeoutPromise])
    if (fetched === null) {
      logger.debug(
        `NPM registry fetch timed out after ${NPM_REGISTRY_FETCH_TIMEOUT_MS}ms`,
      )
      return { name: '@marinade.finance/validator-bonds-...', version: '0.0.0' }
    }
    const fetchedJson = await fetched.json()
    const name: string = fetchedJson.name
    const versionsData: any[] = fetchedJson.versions
    const versions = Object.keys(versionsData) // ['1.0.0', 1.0.1', '1.0.2']
    const sortedVersions = versions.sort(compareVersions)
    const latestVersion = sortedVersions[sortedVersions.length - 1] || '0.0.0'
    return { name, version: latestVersion }
  } catch (err) {
    logger.debug(
      `Failed to fetch latest version from NPM registry ${npmRegistryUrl}: ${String(err)}`,
    )
    return { name: '@marinade.finance/validator-bonds-...', version: '0.0.0' }
  }
}

/**
 * Checks that the CLI is up to date before executing the command.
 * If the registry is unreachable or times out, the CLI is allowed to proceed.
 * If the CLI version is outdated, throws an error to block execution.
 */
export async function requireLatestCliVersion(
  logger: Logger,
  npmRegistryUrl: string,
  currentVersion: string,
): Promise<void> {
  const npmData = await fetchLatestVersionInNpmRegistry(logger, npmRegistryUrl)
  if (compareVersions(currentVersion, npmData.version) < 0) {
    throw new Error(
      `CLI version ${currentVersion} is outdated. The latest available version is ${npmData.version}.\n` +
        '  Please update before proceeding:\n' +
        `  npm install -g ${npmData.name}@latest`,
    )
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
