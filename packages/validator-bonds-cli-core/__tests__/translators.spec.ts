import { CliCommandError, CLIContext } from '@marinade.finance/cli-common'
import { setContext } from '@marinade.finance/ts-common'
import { SolanaJSONRPCError } from '@solana/web3.js'
import pino from 'pino'

import {
  buildRpcRemediationMsg,
  translateRpcConnectivityError,
  translateRpcRateLimitError,
} from '../src/errorTranslators'

beforeAll(() => {
  setContext(
    new CLIContext({
      logger: pino({ level: 'silent' }),
      commandName: 'test-command',
    }),
  )
})

const endpoint = 'http://localhost:8899'

describe('translateRpcConnectivityError', () => {
  it('translates SolanaJSONRPCError Method not found (-32601)', () => {
    const err = new SolanaJSONRPCError({
      code: -32601,
      message: 'Method not found',
    })
    const translated = translateRpcConnectivityError(err, {
      rpcEndpoint: endpoint,
    })
    expect(translated).toBeInstanceOf(CliCommandError)
    expect(translated?.message).toContain('not a Solana RPC')
    expect(translated?.message).toContain(endpoint)
    expect(translated?.cause).toBe(err)
  })

  it('translates Method not found by message even without numeric code', () => {
    const err = new Error('SolanaJSONRPCError: Method not found')
    const translated = translateRpcConnectivityError(err, {
      rpcEndpoint: endpoint,
    })
    expect(translated).toBeInstanceOf(CliCommandError)
    expect(translated?.message).toContain('not a Solana RPC')
  })

  it('translates ECONNREFUSED via cause chain', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    })
    const err = new Error('fetch failed', { cause })
    const translated = translateRpcConnectivityError(err, {
      rpcEndpoint: endpoint,
    })
    expect(translated).toBeInstanceOf(CliCommandError)
    expect(translated?.message).toContain('Nothing listening')
    expect(translated?.message).toContain(endpoint)
  })

  it('translates ENOTFOUND via cause chain', () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND xxx'), {
      code: 'ENOTFOUND',
    })
    const err = new Error('fetch failed', { cause })
    const translated = translateRpcConnectivityError(err, {
      rpcEndpoint: 'https://xxx.invalid',
    })
    expect(translated).toBeInstanceOf(CliCommandError)
    expect(translated?.message).toContain('Cannot resolve host')
  })

  it('translates plain "fetch failed" without explicit cause code', () => {
    const err = new Error('fetch failed')
    const translated = translateRpcConnectivityError(err, {
      rpcEndpoint: endpoint,
    })
    expect(translated).toBeInstanceOf(CliCommandError)
    expect(translated?.message).toContain('Cannot reach RPC')
  })

  it('returns undefined for unrelated errors', () => {
    const err = new Error('something else entirely')
    const translated = translateRpcConnectivityError(err, {
      rpcEndpoint: endpoint,
    })
    expect(translated).toBeUndefined()
  })
})

describe('translateRpcRateLimitError', () => {
  it('translates SolanaJSONRPCError -32005 (node unhealthy)', () => {
    const err = new SolanaJSONRPCError({
      code: -32005,
      message: 'Node is unhealthy',
    })
    const translated = translateRpcRateLimitError(err, {
      rpcEndpoint: endpoint,
    })
    expect(translated).toBeInstanceOf(CliCommandError)
    expect(translated?.message).toContain('rate-limited or unhealthy')
  })

  it('translates errors with 429 in the message', () => {
    const err = new Error('Server responded with 429 Too Many Requests')
    const translated = translateRpcRateLimitError(err, {
      rpcEndpoint: endpoint,
    })
    expect(translated).toBeInstanceOf(CliCommandError)
  })
})

describe('buildRpcRemediationMsg', () => {
  const originalRpcUrl = process.env.RPC_URL

  afterEach(() => {
    if (originalRpcUrl === undefined) {
      delete process.env.RPC_URL
    } else {
      process.env.RPC_URL = originalRpcUrl
    }
  })

  it('reports RPC_URL env var as set without echoing the value', () => {
    process.env.RPC_URL = 'https://example.com/?api-key=super-secret'
    const msg = buildRpcRemediationMsg('Problem.')
    expect(msg).toContain('RPC_URL env var is set')
    expect(msg).toContain('Pass a valid RPC URL')
    expect(msg).not.toContain('super-secret')
    expect(msg).not.toContain('example.com')
  })

  it('reports RPC_URL env var as not set when missing', () => {
    delete process.env.RPC_URL
    const msg = buildRpcRemediationMsg('Problem.')
    expect(msg).toContain('RPC_URL env var is not set')
  })
})
