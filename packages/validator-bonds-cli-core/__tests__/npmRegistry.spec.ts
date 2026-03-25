import {
  compareVersions,
  fetchLatestVersionInNpmRegistry,
} from '../src/npmRegistry'

import type { Logger } from 'pino'

const mockLogger = { debug: jest.fn() } as unknown as Logger

describe('compareVersions', () => {
  it('compares basic versions', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0)
    expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0)
  })

  it('compares minor and patch versions', () => {
    expect(compareVersions('1.2.0', '1.3.0')).toBeLessThan(0)
    expect(compareVersions('1.2.3', '1.2.4')).toBeLessThan(0)
    expect(compareVersions('2.4.0', '2.4.0')).toBe(0)
  })

  it('handles missing parts as zero', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('1', '1.0.0')).toBe(0)
  })

  it('prerelease sorts below same release version', () => {
    expect(compareVersions('2.4.1-beta', '2.4.1')).toBeLessThan(0)
    expect(compareVersions('2.4.1', '2.4.1-beta')).toBeGreaterThan(0)
    expect(compareVersions('2.4.1-alpha', '2.4.1')).toBeLessThan(0)
  })

  it('prerelease sorts above lower release version', () => {
    expect(compareVersions('2.4.1-beta', '2.4.0')).toBeGreaterThan(0)
    expect(compareVersions('2.4.1-beta', '2.3.9')).toBeGreaterThan(0)
    expect(compareVersions('2.4.1-beta.1', '2.4.0')).toBeGreaterThan(0)
  })

  it('compares prerelease identifiers lexically', () => {
    expect(compareVersions('2.4.1-alpha', '2.4.1-beta')).toBeLessThan(0)
    expect(compareVersions('2.4.1-beta', '2.4.1-alpha')).toBeGreaterThan(0)
    expect(compareVersions('2.4.1-beta.1', '2.4.1-beta.2')).toBeLessThan(0)
    expect(compareVersions('2.4.1-beta.10', '2.4.1-beta.2')).toBeGreaterThan(0)
  })

  it('two identical prereleases are equal', () => {
    expect(compareVersions('2.4.1-beta', '2.4.1-beta')).toBe(0)
    expect(compareVersions('2.4.1-beta.1', '2.4.1-beta.1')).toBe(0)
  })

  it('sorts a list of versions correctly', () => {
    const versions = [
      '2.4.1',
      '2.4.0',
      '2.4.1-beta',
      '1.0.0',
      '2.4.1-alpha',
      '2.3.100-beta',
      '2.5.0',
    ]
    const sorted = [...versions].sort(compareVersions)
    expect(sorted).toEqual([
      '1.0.0',
      '2.3.100-beta',
      '2.4.0',
      '2.4.1-alpha',
      '2.4.1-beta',
      '2.4.1',
      '2.5.0',
    ])
  })

  it('prerelease with compound tag handles hyphens', () => {
    // "rc-1" has a hyphen within the prerelease part
    expect(compareVersions('2.4.1-rc-1', '2.4.1')).toBeLessThan(0)
    expect(compareVersions('2.4.1-rc-1', '2.4.0')).toBeGreaterThan(0)
  })
})

describe('fetchLatestVersionInNpmRegistry', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns latest stable version ignoring prereleases', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: () => ({
        name: '@marinade.finance/validator-bonds-cli',
        versions: {
          '2.3.0': {},
          '2.4.0': {},
          '2.4.1-beta.1': {},
          '2.4.1-beta.2': {},
        },
      }),
    })

    const result = await fetchLatestVersionInNpmRegistry(
      mockLogger,
      'https://registry.npmjs.org/@marinade.finance/validator-bonds-cli',
    )
    expect(result).toEqual({
      name: '@marinade.finance/validator-bonds-cli',
      version: '2.4.0',
    })
  })

  it('falls back to all versions when no stable versions exist', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: () => ({
        name: '@marinade.finance/validator-bonds-cli',
        versions: {
          '2.4.1-beta.1': {},
          '2.4.1-beta.2': {},
        },
      }),
    })

    const result = await fetchLatestVersionInNpmRegistry(
      mockLogger,
      'https://registry.npmjs.org/@marinade.finance/validator-bonds-cli',
    )
    expect(result).toEqual({
      name: '@marinade.finance/validator-bonds-cli',
      version: '2.4.1-beta.2',
    })
  })
})
