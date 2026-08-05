import {
  compareVersions,
  fetchLatestVersionInNpmRegistry,
  requireLatestCliVersion,
} from '../src/npmRegistry'

import type { Logger } from 'pino'

const mockLogger = { debug: jest.fn() } as unknown as Logger

// a fetch that only settles once the caller's own deadline fires, so tests exercise the real abort
const rejectOnAbort =
  (error: Error) =>
  (...args: unknown[]) => {
    const { signal } = args[1] as { signal: AbortSignal }
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(error))
    })
  }

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
    jest.clearAllMocks()
  })

  it('returns latest stable version ignoring prereleases', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => ({
        name: '@marinade.finance/validator-bonds-cli',
        versions: {
          '2.3.0': {},
          '2.4.0': {},
          '2.4.1-beta.1': {},
          '2.4.1-beta.2': {},
        },
      }),
    }) as unknown as typeof fetch

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
      ok: true,
      json: () => ({
        name: '@marinade.finance/validator-bonds-cli',
        versions: {
          '2.4.1-beta.1': {},
          '2.4.1-beta.2': {},
        },
      }),
    }) as unknown as typeof fetch

    const result = await fetchLatestVersionInNpmRegistry(
      mockLogger,
      'https://registry.npmjs.org/@marinade.finance/validator-bonds-cli',
    )
    expect(result).toEqual({
      name: '@marinade.finance/validator-bonds-cli',
      version: '2.4.1-beta.2',
    })
  })

  it('retries once and stays silent when a transport failure recovers', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(
        new TypeError('fetch failed', { cause: new Error('ECONNRESET') }),
      )
      .mockResolvedValueOnce({
        ok: true,
        json: () => ({
          name: '@marinade.finance/validator-bonds-cli',
          versions: { '2.5.0': {} },
        }),
      })
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await fetchLatestVersionInNpmRegistry(
      mockLogger,
      'https://registry.npmjs.org/@marinade.finance/validator-bonds-cli',
    )
    expect(result).toEqual({
      name: '@marinade.finance/validator-bonds-cli',
      version: '2.5.0',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(mockLogger.debug).not.toHaveBeenCalled()
  })

  it('does not retry an HTTP status and reports it', async () => {
    const json = jest.fn()
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json,
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await fetchLatestVersionInNpmRegistry(
      mockLogger,
      'https://registry.npmjs.org/@marinade.finance/validator-bonds-cli',
    )
    expect(result).toEqual({
      name: '@marinade.finance/validator-bonds-cli',
      version: '0.0.0',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(json).not.toHaveBeenCalled()
    expect(mockLogger.debug).toHaveBeenCalledTimes(1)
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Error: HTTP 429 Too Many Requests'),
    )
  })

  it('reports the transport cause once both attempts fail', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValue(
        new TypeError('fetch failed', { cause: new Error('ECONNRESET') }),
      )
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await fetchLatestVersionInNpmRegistry(
      mockLogger,
      'https://registry.npmjs.org/@marinade.finance/validator-bonds-cli',
    )
    expect(result).toEqual({
      name: '@marinade.finance/validator-bonds-cli',
      version: '0.0.0',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(mockLogger.debug).toHaveBeenCalledTimes(1)
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining(
        'TypeError: fetch failed (cause: Error: ECONNRESET)',
      ),
    )
  })

  it('falls back to the known package name when the packument omits it', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => ({ versions: { '2.9.0': {} } }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await fetchLatestVersionInNpmRegistry(
      mockLogger,
      'https://registry.npmjs.org/@marinade.finance/validator-bonds-cli',
    )
    expect(result).toEqual({
      name: '@marinade.finance/validator-bonds-cli',
      version: '2.9.0',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mockLogger.debug).not.toHaveBeenCalled()
  })

  it('does not retry a malformed packument and reports no TypeError', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => ({ name: '@marinade.finance/validator-bonds-cli' }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await fetchLatestVersionInNpmRegistry(
      mockLogger,
      'https://registry.npmjs.org/@marinade.finance/validator-bonds-cli',
    )
    expect(result).toEqual({
      name: '@marinade.finance/validator-bonds-cli',
      version: '0.0.0',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mockLogger.debug).toHaveBeenCalledTimes(1)
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Error: registry response contains no versions'),
    )
    expect(mockLogger.debug).not.toHaveBeenCalledWith(
      expect.stringContaining('TypeError:'),
    )
  })

  it('keeps the transport cause when the retry hits the shared deadline', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(
        new TypeError('fetch failed', { cause: new Error('ECONNRESET') }),
      )
      .mockImplementationOnce(
        rejectOnAbort(
          new DOMException('This operation was aborted', 'AbortError'),
        ),
      )
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await fetchLatestVersionInNpmRegistry(
      mockLogger,
      'https://registry.npmjs.org/@marinade.finance/validator-bonds-cli',
    )
    expect(result).toEqual({
      name: '@marinade.finance/validator-bonds-cli',
      version: '0.0.0',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(mockLogger.debug).toHaveBeenCalledTimes(1)
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining(
        'TypeError: fetch failed (cause: Error: ECONNRESET)',
      ),
    )
  })

  it('does not retry a transport failure that lands after the deadline', async () => {
    const fetchMock = jest.fn(
      rejectOnAbort(
        new TypeError('fetch failed', { cause: new Error('ECONNRESET') }),
      ),
    )
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await fetchLatestVersionInNpmRegistry(
      mockLogger,
      'https://registry.npmjs.org/@marinade.finance/validator-bonds-cli',
    )
    expect(result).toEqual({
      name: '@marinade.finance/validator-bonds-cli',
      version: '0.0.0',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mockLogger.debug).toHaveBeenCalledTimes(1)
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining(
        'TypeError: fetch failed (cause: Error: ECONNRESET)',
      ),
    )
  })

  it('does not retry a timeout and reports it without a cause suffix', async () => {
    const fetchMock = jest.fn(
      rejectOnAbort(
        new DOMException('This operation was aborted', 'AbortError'),
      ),
    )
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await fetchLatestVersionInNpmRegistry(
      mockLogger,
      'https://registry.npmjs.org/@marinade.finance/validator-bonds-cli',
    )
    expect(result).toEqual({
      name: '@marinade.finance/validator-bonds-cli',
      version: '0.0.0',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mockLogger.debug).toHaveBeenCalledTimes(1)
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'NPM registry fetch timed out after 1000ms',
    )
  })
})

describe('requireLatestCliVersion', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.clearAllMocks()
  })

  it('recommends the exact version it compared against, not @latest', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => ({
        name: '@marinade.finance/validator-bonds-cli',
        versions: { '2.4.0': {}, '2.5.0': {} },
      }),
    }) as unknown as typeof fetch

    await expect(
      requireLatestCliVersion(
        mockLogger,
        'https://registry.npmjs.org/@marinade.finance/validator-bonds-cli',
        '2.4.0',
      ),
    ).rejects.toThrow(
      'npm install -g @marinade.finance/validator-bonds-cli@2.5.0',
    )
  })
})
