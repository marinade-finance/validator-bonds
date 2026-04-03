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
import type { ServerResponse } from 'http'

const NOTIFICATIONS_API_PORT = 13579

beforeAll(() => {
  extendJestWithShellMatchers()
})

describe('CLI Notification Banners', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let testServer: TestHttpServer

  const mockBroadcastNotifications = [
    {
      id: 1,
      notification_type: 'sam_auction',
      inner_type: 'announcement',
      user_id: 'MarinadeNotifications1111111111111111111111',
      scope: 'broadcast',
      priority: 'info',
      message: 'This is a test announcement message',
      data: {},
      notification_id: null,
      relevance_until: '2099-01-01T00:00:00Z',
      created_at: '2024-01-01T00:00:00Z',
    },
  ]

  beforeAll(async () => {
    extendJestWithShellMatchers()
    ;({ provider, program } = initTest('processed'))

    testServer = new TestHttpServer(NOTIFICATIONS_API_PORT)
    testServer.addRoute(
      '/v1/notifications/broadcast',
      (_, res: ServerResponse) => {
        TestHttpServer.sendAsJson(
          res,
          JSON.stringify(mockBroadcastNotifications),
        )
      },
    )
    await testServer.start()
  })

  afterAll(async () => {
    await testServer.stop()
  })

  it('displays notification banners after command execution', async () => {
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
        },
      },
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      signal: '',
      stdout: /This is a test announcement message/,
    })
  })

  it('handles multiple notification banners in order', async () => {
    const multipleNotifications = [
      {
        id: 1,
        notification_type: 'sam_auction',
        inner_type: 'announcement',
        user_id: 'MarinadeNotifications1111111111111111111111',
        scope: 'broadcast',
        priority: 'info',
        message: 'First message',
        data: {},
        notification_id: null,
        relevance_until: '2099-01-01T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z',
      },
      {
        id: 2,
        notification_type: 'sam_auction',
        inner_type: 'announcement',
        user_id: 'MarinadeNotifications1111111111111111111111',
        scope: 'broadcast',
        priority: 'info',
        message: 'Second message without title',
        data: {},
        notification_id: null,
        relevance_until: '2099-01-01T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z',
      },
    ]

    const multiServer = new TestHttpServer(13580)
    multiServer.addRoute(
      '/v1/notifications/broadcast',
      (_, res: ServerResponse) => {
        TestHttpServer.sendAsJson(res, JSON.stringify(multipleNotifications))
      },
    )
    await multiServer.start()

    try {
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
            NOTIFICATIONS_API_URL: multiServer.baseUrl,
          },
        },
      ]).toHaveMatchingSpawnOutput({
        code: 0,
        signal: '',
        stdout: /First message[\s\S]*Second message without title/,
      })
    } finally {
      await multiServer.stop()
    }
  })

  it('gracefully handles API errors', async () => {
    const errorServer = new TestHttpServer(13581)
    errorServer.addRoute(
      '/v1/notifications/broadcast',
      (_, res: ServerResponse) => {
        res.writeHead(500)
        res.end('Internal Server Error')
      },
    )
    await errorServer.start()

    try {
      const tx = await transaction(provider)
      const admin = Keypair.generate().publicKey
      const operator = Keypair.generate().publicKey
      const { instruction: initConfigIx, configAccount } =
        await initConfigInstruction({
          program,
          admin,
          operator,
          epochsToClaimSettlement: 301,
          slotsToStartSettlementClaiming: 302,
          withdrawLockupEpochs: 303,
        })
      tx.add(initConfigIx)
      const [configKeypair, configPubkey] = signerWithPubkey(configAccount)
      await executeTxSimple(provider.connection, tx, [
        provider.wallet,
        configKeypair,
      ])

      // CLI should still work even when notifications API fails
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
            NOTIFICATIONS_API_URL: errorServer.baseUrl,
          },
        },
      ]).toHaveMatchingSpawnOutput({
        code: 0,
        signal: '',
        stdout: new RegExp(configPubkey.toBase58()),
      })
    } finally {
      await errorServer.stop()
    }
  })

  it('handles empty notifications response', async () => {
    const emptyServer = new TestHttpServer(13582)
    emptyServer.addRoute(
      '/v1/notifications/broadcast',
      (_, res: ServerResponse) => {
        TestHttpServer.sendAsJson(res, JSON.stringify([]))
      },
    )
    await emptyServer.start()

    try {
      const tx = await transaction(provider)
      const admin = Keypair.generate().publicKey
      const operator = Keypair.generate().publicKey
      const { instruction: initConfigIx, configAccount } =
        await initConfigInstruction({
          program,
          admin,
          operator,
          epochsToClaimSettlement: 401,
          slotsToStartSettlementClaiming: 402,
          withdrawLockupEpochs: 403,
        })
      tx.add(initConfigIx)
      const [configKeypair, configPubkey] = signerWithPubkey(configAccount)
      await executeTxSimple(provider.connection, tx, [
        provider.wallet,
        configKeypair,
      ])

      // CLI should work normally with no notifications displayed
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
            NOTIFICATIONS_API_URL: emptyServer.baseUrl,
          },
        },
      ]).toHaveMatchingSpawnOutput({
        code: 0,
        signal: '',
        stdout: new RegExp(configPubkey.toBase58()),
      })
    } finally {
      await emptyServer.stop()
    }
  })
})
