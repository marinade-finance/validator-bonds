import { extendJestWithShellMatchers } from '@marinade.finance/jest-shell-matcher'
import { TestHttpServer } from '@marinade.finance/ts-common'
import { initConfigInstruction } from '@marinade.finance/validator-bonds-sdk'
import { initTest } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testValidator'
import {
  executeTxSimple,
  signerWithPubkey,
  transaction,
} from '@marinade.finance/web3js-1x'
import { Keypair } from '@solana/web3.js'

import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import type { ValidatorBondsProgram } from '@marinade.finance/validator-bonds-sdk'
import type { IncomingMessage, ServerResponse } from 'http'

const CLI_USAGE_API_PORT = 13590

beforeAll(() => {
  extendJestWithShellMatchers()
})

describe('CLI Usage Reporting', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let testServer: TestHttpServer
  let cliUsageRequests: Array<{ method: string; url: string }>

  beforeAll(async () => {
    ;({ provider, program } = initTest('processed'))

    cliUsageRequests = []
    testServer = new TestHttpServer(CLI_USAGE_API_PORT)
    testServer.addRoute(
      '/v1/cli-usage',
      (req: IncomingMessage, res: ServerResponse) => {
        cliUsageRequests.push({
          method: req.method ?? '',
          url: req.url ?? '',
        })
        res.writeHead(204)
        res.end()
      },
    )
    testServer.addRoute(
      '/v1/notifications/broadcast',
      (_: IncomingMessage, res: ServerResponse) => {
        TestHttpServer.sendAsJson(res, JSON.stringify([]))
      },
    )
    await testServer.start()
  })

  afterAll(async () => {
    await testServer.stop()
  })

  beforeEach(() => {
    cliUsageRequests.length = 0
  })

  it('posts to /v1/cli-usage with operation and account on command invocation', async () => {
    const tx = await transaction(provider)
    const admin = Keypair.generate().publicKey
    const operator = Keypair.generate().publicKey
    const { instruction: initConfigIx, configAccount } =
      await initConfigInstruction({
        program,
        admin,
        operator,
        epochsToClaimSettlement: 101,
        slotsToStartSettlementClaiming: 102,
        withdrawLockupEpochs: 103,
      })
    tx.add(initConfigIx)
    const [configKeypair, configPubkey] = signerWithPubkey(configAccount)
    await executeTxSimple(provider.connection, tx, [
      provider.wallet,
      configKeypair,
    ])

    await expect([
      'pnpm',
      [
        '--silent',
        'cli',
        '-u',
        provider.connection.rpcEndpoint,
        '--program-id',
        program.programId.toBase58(),
        'show-config',
        configPubkey.toBase58(),
        '-f',
        'yaml',
      ],
      {
        env: {
          ...process.env,
          NOTIFICATIONS_API_URL: testServer.baseUrl,
          CLI_USAGE_API_URL: testServer.baseUrl,
        },
      },
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      signal: '',
      stdout: new RegExp(configPubkey.toBase58()),
    })

    expect(cliUsageRequests).toHaveLength(1)
    const request = cliUsageRequests[0]!
    expect(request.method).toBe('POST')

    const requestUrl = new URL(request.url, testServer.baseUrl)
    expect(requestUrl.pathname).toBe('/v1/cli-usage')
    expect(requestUrl.searchParams.get('type')).toBe('sam')
    expect(requestUrl.searchParams.get('operation')).toBe('show-config')
    expect(requestUrl.searchParams.get('account')).toBe(configPubkey.toBase58())
    expect(requestUrl.searchParams.get('cli_version')).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('posts to /v1/cli-usage with no `account` param when the positional pubkey is omitted', async () => {
    // `show-config`'s positional argument is optional (`[config-address]`).
    // Omitting it leaves `action.processedArgs[0]` undefined — the
    // `arg instanceof PublicKey` guard in the preAction hook then drops
    // to `account = undefined` and the CLI-side `if (params.account)`
    // check skips setting the URL param. The command itself falls back
    // to listing all on-chain config accounts (exit 0); we only care
    // that the telemetry POST fires and carries no `account`.
    await expect([
      'pnpm',
      [
        '--silent',
        'cli',
        '-u',
        provider.connection.rpcEndpoint,
        '--program-id',
        program.programId.toBase58(),
        'show-config',
        '-f',
        'yaml',
      ],
      {
        env: {
          ...process.env,
          NOTIFICATIONS_API_URL: testServer.baseUrl,
          CLI_USAGE_API_URL: testServer.baseUrl,
        },
      },
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      signal: '',
    })

    expect(cliUsageRequests).toHaveLength(1)
    const request = cliUsageRequests[0]!
    expect(request.method).toBe('POST')

    const requestUrl = new URL(request.url, testServer.baseUrl)
    expect(requestUrl.pathname).toBe('/v1/cli-usage')
    expect(requestUrl.searchParams.get('type')).toBe('sam')
    expect(requestUrl.searchParams.get('operation')).toBe('show-config')
    expect(requestUrl.searchParams.get('cli_version')).toMatch(/^\d+\.\d+\.\d+/)
    expect(requestUrl.searchParams.has('account')).toBe(false)
  })

  it('does not block command completion when cli-usage API is unreachable', async () => {
    const tx = await transaction(provider)
    const admin = Keypair.generate().publicKey
    const operator = Keypair.generate().publicKey
    const { instruction: initConfigIx, configAccount } =
      await initConfigInstruction({
        program,
        admin,
        operator,
        epochsToClaimSettlement: 201,
        slotsToStartSettlementClaiming: 202,
        withdrawLockupEpochs: 203,
      })
    tx.add(initConfigIx)
    const [configKeypair, configPubkey] = signerWithPubkey(configAccount)
    await executeTxSimple(provider.connection, tx, [
      provider.wallet,
      configKeypair,
    ])

    // point the CLI at a port nothing listens on
    await expect([
      'pnpm',
      [
        '--silent',
        'cli',
        '-u',
        provider.connection.rpcEndpoint,
        '--program-id',
        program.programId.toBase58(),
        'show-config',
        configPubkey.toBase58(),
        '-f',
        'yaml',
      ],
      {
        env: {
          ...process.env,
          NOTIFICATIONS_API_URL: testServer.baseUrl,
          CLI_USAGE_API_URL: 'http://127.0.0.1:1',
        },
      },
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      signal: '',
      stdout: new RegExp(configPubkey.toBase58()),
    })
  })
})
