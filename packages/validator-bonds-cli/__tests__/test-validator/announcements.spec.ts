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

const ANNOUNCEMENTS_API_PORT = 13579

beforeAll(() => {
  extendJestWithShellMatchers()
})

describe('CLI Announcements', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let testServer: TestHttpServer

  const mockAnnouncements = {
    announcements: [
      {
        id: 1,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        group_id: 1,
        group_order: 0,
        title: 'Test Announcement',
        text: 'This is a test announcement message',
        enabled: true,
        operation_filter: null,
        vote_account_filter: null,
        type_filter: 'sam',
      },
    ],
  }

  beforeAll(async () => {
    extendJestWithShellMatchers()
    ;({ provider, program } = initTest('processed'))

    testServer = new TestHttpServer(ANNOUNCEMENTS_API_PORT)
    testServer.addRoute('/v1/announcements', (_, res: ServerResponse) => {
      TestHttpServer.sendAsJson(res, JSON.stringify(mockAnnouncements))
    })
    await testServer.start()
  })

  afterAll(async () => {
    await testServer.stop()
  })

  it('displays announcements after command execution', async () => {
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
          ANNOUNCEMENTS_API_URL: `${testServer.baseUrl}/v1/announcements`,
        },
      },
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      signal: '',
      // Check that the announcement title and text appear in stdout
      stdout: /Test Announcement[\s\S]*This is a test announcement message/,
    })
  })

  it('handles multiple announcements in order', async () => {
    const multipleAnnouncements = {
      announcements: [
        {
          id: 1,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          group_id: 1,
          group_order: 0,
          title: 'First Announcement',
          text: 'First message',
          enabled: true,
          operation_filter: null,
          vote_account_filter: null,
          type_filter: 'sam',
        },
        {
          id: 2,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          group_id: 1,
          group_order: 1,
          title: null,
          text: 'Second message without title',
          enabled: true,
          operation_filter: null,
          vote_account_filter: null,
          type_filter: 'sam',
        },
      ],
    }

    const multiServer = new TestHttpServer(13580)
    multiServer.addRoute('/v1/announcements', (_, res: ServerResponse) => {
      TestHttpServer.sendAsJson(res, JSON.stringify(multipleAnnouncements))
    })
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
            ANNOUNCEMENTS_API_URL: `${multiServer.baseUrl}/v1/announcements`,
          },
        },
      ]).toHaveMatchingSpawnOutput({
        code: 0,
        signal: '',
        stdout:
          /First Announcement[\s\S]*First message[\s\S]*Second message without title/,
      })
    } finally {
      await multiServer.stop()
    }
  })

  it('gracefully handles API errors', async () => {
    const errorServer = new TestHttpServer(13581)
    errorServer.addRoute('/v1/announcements', (_, res: ServerResponse) => {
      res.writeHead(500)
      res.end('Internal Server Error')
    })
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

      // CLI should still work even when announcements API fails
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
            ANNOUNCEMENTS_API_URL: `${errorServer.baseUrl}/v1/announcements`,
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

  it('handles empty announcements response', async () => {
    const emptyServer = new TestHttpServer(13582)
    emptyServer.addRoute('/v1/announcements', (_, res: ServerResponse) => {
      TestHttpServer.sendAsJson(res, JSON.stringify({ announcements: [] }))
    })
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

      // CLI should work normally with no announcements displayed
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
            ANNOUNCEMENTS_API_URL: `${emptyServer.baseUrl}/v1/announcements`,
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
