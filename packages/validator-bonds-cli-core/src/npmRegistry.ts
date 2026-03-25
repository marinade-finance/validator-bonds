/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import type { Logger } from 'pino'

export type NpmPackageData = {
  name: string
  version: string
}

const NPM_REGISTRY_FETCH_TIMEOUT_MS = 1000
const FALLBACK_PACKAGE: NpmPackageData = {
  name: '@marinade.finance/validator-bonds-cli',
  version: '0.0.0',
}

export async function fetchLatestVersionInNpmRegistry(
  logger: Logger,
  npmRegistryUrl: string,
): Promise<NpmPackageData> {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    NPM_REGISTRY_FETCH_TIMEOUT_MS,
  )
  try {
    const fetched = await fetch(npmRegistryUrl, {
      method: 'GET',
      signal: controller.signal,
    })
    const fetchedJson = await fetched.json()
    const name: string = fetchedJson.name
    const versionsData: any[] = fetchedJson.versions
    const versions = Object.keys(versionsData) // ['1.0.0', 1.0.1', '1.0.2']
    const stableVersions = versions.filter(v => !v.includes('-'))
    const sortedVersions = (
      stableVersions.length > 0 ? stableVersions : versions
    ).sort(compareVersions)
    const latestVersion = sortedVersions[sortedVersions.length - 1] || '0.0.0'
    return { name, version: latestVersion }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      logger.debug(
        `NPM registry fetch timed out after ${NPM_REGISTRY_FETCH_TIMEOUT_MS}ms`,
      )
    } else {
      logger.debug(
        `Failed to fetch latest version from NPM registry ${npmRegistryUrl}: ${String(err)}`,
      )
    }
    return FALLBACK_PACKAGE
  } finally {
    clearTimeout(timeout)
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
  // Split version into [major, minor, patch] and optional prerelease tag
  // e.g., "2.4.1-beta.1" → core [2, 4, 1], prerelease "beta.1"
  const parse = (version: string) => {
    const [core = '', ...rest] = version.split('-')
    const parts = core.split('.').map(p => parseInt(p, 10) || 0)
    const prerelease = rest.length > 0 ? rest.join('-') : undefined
    return { parts, prerelease }
  }

  const av = parse(a)
  const bv = parse(b)

  for (let i = 0; i < Math.max(av.parts.length, bv.parts.length); i++) {
    const aPart = av.parts[i] ?? 0
    const bPart = bv.parts[i] ?? 0
    if (aPart !== bPart) {
      return aPart - bPart
    }
  }

  // Same numeric version: prerelease sorts below release (2.4.1-beta < 2.4.1)
  if (av.prerelease && !bv.prerelease) return -1
  if (!av.prerelease && bv.prerelease) return 1
  if (av.prerelease && bv.prerelease) {
    const aIds = av.prerelease.split('.')
    const bIds = bv.prerelease.split('.')
    for (let i = 0; i < Math.max(aIds.length, bIds.length); i++) {
      if (i >= aIds.length) return -1
      if (i >= bIds.length) return 1
      const aId = aIds[i] as string
      const bId = bIds[i] as string
      const aNum = parseInt(aId, 10)
      const bNum = parseInt(bId, 10)
      const aIsNum = !isNaN(aNum) && String(aNum) === aId
      const bIsNum = !isNaN(bNum) && String(bNum) === bId
      if (aIsNum && bIsNum) {
        if (aNum !== bNum) return aNum - bNum
      } else if (aIsNum) {
        return -1
      } else if (bIsNum) {
        return 1
      } else {
        const cmp = aId.localeCompare(bId)
        if (cmp !== 0) return cmp
      }
    }
  }

  return 0
}
