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
import type { PublicKey } from '@solana/web3.js'
import type { IncomingMessage, ServerResponse } from 'http'

const MIX_PROXY_PORT = 13590
const TEST_TOKEN = 'ci-test-token'

type CapturedEvent = {
  event: string
  properties: Record<string, unknown>
}

async function readJsonBody(req: IncomingMessage): Promise<CapturedEvent[]> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as CapturedEvent[]
}

beforeAll(() => {
  extendJestWithShellMatchers()
})

describe('CLI Mixpanel Reporting', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let testServer: TestHttpServer
  let capturedEvents: CapturedEvent[]

  beforeAll(async () => {
    ;({ provider, program } = initTest('processed'))

    capturedEvents = []
    testServer = new TestHttpServer(MIX_PROXY_PORT)
    testServer.addRoute(
      '/track',
      async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const events = await readJsonBody(req)
          capturedEvents.push(...events)
        } catch {
          // ignore malformed bodies in tests; assertions on shape will catch them
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('1')
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
    capturedEvents.length = 0
  })

  async function makeConfig(epochs: number): Promise<PublicKey> {
    const tx = await transaction(provider)
    const admin = Keypair.generate().publicKey
    const operator = Keypair.generate().publicKey
    const { instruction: initConfigIx, configAccount } =
      await initConfigInstruction({
        program,
        admin,
        operator,
        epochsToClaimSettlement: epochs,
        slotsToStartSettlementClaiming: epochs + 1,
        withdrawLockupEpochs: epochs + 2,
      })
    tx.add(initConfigIx)
    const [configKeypair, configPubkey] = signerWithPubkey(configAccount)
    await executeTxSimple(provider.connection, tx, [
      provider.wallet,
      configKeypair,
    ])
    return configPubkey
  }

  it('emits cli_command and cli_command_complete sharing session_id', async () => {
    const configPubkey = await makeConfig(101)

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
          MIX_PROXY_URL: testServer.baseUrl,
          MIXPANEL_TOKEN_TEST: TEST_TOKEN,
        },
      },
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      signal: '',
      stdout: new RegExp(configPubkey.toBase58()),
    })

    expect(capturedEvents).toHaveLength(2)
    const [first, second] = capturedEvents

    expect(first!.event).toBe('cli_command')
    expect(first!.properties.token).toBe(TEST_TOKEN)
    expect(first!.properties.cli_name).toBe('sam')
    expect(first!.properties.operation).toBe('show-config')
    expect(first!.properties.config_account).toBe(configPubkey.toBase58())
    expect(first!.properties.simulate).toBe(false)
    expect(first!.properties.print_only).toBe(false)
    expect(first!.properties.os).toBe(process.platform)
    expect(first!.properties.arch).toBe(process.arch)
    expect(typeof first!.properties.node_version).toBe('string')
    expect(typeof first!.properties.session_id).toBe('string')
    expect(first!.properties.cli_version).toMatch(/^\d+\.\d+\.\d+/)

    const walletId = first!.properties.distinct_id
    expect(typeof walletId).toBe('string')
    expect((walletId as string).length).toBeGreaterThan(30)
    expect(first!.properties.$user_id).toBe(walletId)
    const deviceId = first!.properties.$device_id
    expect(typeof deviceId).toBe('string')
    expect((deviceId as string).length).toBeGreaterThan(8)
    expect(typeof first!.properties.$insert_id).toBe('string')

    expect(second!.event).toBe('cli_command_complete')
    expect(second!.properties.token).toBe(TEST_TOKEN)
    expect(second!.properties.result).toBe('success')
    expect(typeof second!.properties.duration_ms).toBe('number')
    expect(second!.properties.session_id).toBe(first!.properties.session_id)
    expect(second!.properties.distinct_id).toBe(walletId)
    expect(second!.properties.$device_id).toBe(deviceId)
  })

  it('omits the typed account property when no positional pubkey is given', async () => {
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
          MIX_PROXY_URL: testServer.baseUrl,
          MIXPANEL_TOKEN_TEST: TEST_TOKEN,
        },
      },
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      signal: '',
    })

    expect(capturedEvents).toHaveLength(2)
    const [first] = capturedEvents
    expect(first!.event).toBe('cli_command')
    expect(first!.properties.operation).toBe('show-config')
    expect(first!.properties.config_account).toBeUndefined()
    expect(first!.properties.account).toBeUndefined()
  })

  it('does not block command completion when the proxy is unreachable', async () => {
    const configPubkey = await makeConfig(201)

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
          MIX_PROXY_URL: 'http://127.0.0.1:1',
          MIXPANEL_TOKEN_TEST: TEST_TOKEN,
        },
      },
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      signal: '',
      stdout: new RegExp(configPubkey.toBase58()),
    })
  })

  it('emits zero events when DO_NOT_TRACK=1', async () => {
    const configPubkey = await makeConfig(301)

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
          MIX_PROXY_URL: testServer.baseUrl,
          MIXPANEL_TOKEN_TEST: TEST_TOKEN,
          DO_NOT_TRACK: '1',
        },
      },
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      signal: '',
      stdout: new RegExp(configPubkey.toBase58()),
    })

    expect(capturedEvents).toHaveLength(0)
  })

  it('emits zero events when no Mixpanel token is configured', async () => {
    const configPubkey = await makeConfig(401)

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
          MIX_PROXY_URL: testServer.baseUrl,
          // Pin the placeholder sentinel so telemetry is disabled regardless of
          // whether the built dist has been token-injected.
          MIXPANEL_TOKEN_TEST: '__MIXPANEL_TOKEN_PLACEHOLDER__',
        },
      },
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      signal: '',
      stdout: new RegExp(configPubkey.toBase58()),
    })

    expect(capturedEvents).toHaveLength(0)
  })

  it('emits cli_command_complete with a non-success result when the subcommand fails', async () => {
    const configPubkey = await makeConfig(501)

    await expect([
      'pnpm',
      [
        '--silent',
        'cli',
        '-u',
        'http://127.0.0.1:1',
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
          MIX_PROXY_URL: testServer.baseUrl,
          MIXPANEL_TOKEN_TEST: TEST_TOKEN,
        },
      },
    ]).toHaveMatchingSpawnOutput({
      code: 200,
      signal: '',
    })

    expect(capturedEvents).toHaveLength(2)
    const [first, second] = capturedEvents
    expect(first!.event).toBe('cli_command')
    expect(second!.event).toBe('cli_command_complete')
    expect(second!.properties.result).not.toBe('success')
    expect(second!.properties.result).toEqual(
      expect.stringMatching(/^(network_error|other|transaction_error)$/),
    )
    expect(second!.properties.session_id).toBe(first!.properties.session_id)
  })
})
