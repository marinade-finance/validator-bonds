import { getAnchorValidatorInfo } from '@marinade.finance/anchor-common'
import { extendJestWithShellMatchers } from '@marinade.finance/jest-shell-matcher'
import { TestHttpServer } from '@marinade.finance/ts-common'
import { initTest } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testValidator'
import { createVoteAccountWithIdentity } from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/staking'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/testTransactions'
import { createTempFileKeypair } from '@marinade.finance/web3js-1x'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'

import { airdrop } from './utils'

import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import type { ValidatorBondsProgram } from '@marinade.finance/validator-bonds-sdk'
import type { PublicKey, Keypair } from '@solana/web3.js'
import type { IncomingMessage, ServerResponse } from 'http'

const NOTIFICATIONS_API_PORT = 13590

describe('CLI subscription commands', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let rentPayerKeypair: Keypair
  let rentPayerCleanup: () => Promise<void>
  const rentPayerFunds = 10 * LAMPORTS_PER_SOL
  let configAccount: PublicKey
  let voteAccount: PublicKey
  let validatorIdentityPath: string
  let bondAccount: PublicKey
  let testServer: TestHttpServer

  beforeAll(async () => {
    extendJestWithShellMatchers()
    ;({ provider, program } = initTest())

    testServer = new TestHttpServer(NOTIFICATIONS_API_PORT)
    testServer.addRoute(
      '/subscriptions',
      (req: IncomingMessage, res: ServerResponse) => {
        if (req.method === 'POST') {
          TestHttpServer.sendAsJson(
            res,
            JSON.stringify({ status: 'ok', deep_link: 'https://t.me/test' }),
          )
        } else if (req.method === 'DELETE') {
          TestHttpServer.sendAsJson(res, JSON.stringify({ status: 'ok' }))
        } else if (req.method === 'GET') {
          TestHttpServer.sendAsJson(
            res,
            JSON.stringify([
              {
                channel: 'telegram',
                channel_address: '@testuser',
                notification_type: 'bonds',
              },
            ]),
          )
        } else {
          res.writeHead(405)
          res.end('Method Not Allowed')
        }
      },
    )
    await testServer.start()
  })

  afterAll(async () => {
    await testServer.stop()
  })

  beforeEach(async () => {
    ;({ keypair: rentPayerKeypair, cleanup: rentPayerCleanup } =
      await createTempFileKeypair())
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
      epochsToClaimSettlement: 1,
      withdrawLockupEpochs: 2,
    }))

    let validatorIdentity: Keypair
    ;({ validatorIdentity, validatorIdentityPath } =
      await getAnchorValidatorInfo(provider.connection))
    ;({ voteAccount } = await createVoteAccountWithIdentity(
      provider,
      validatorIdentity,
    ))

    await airdrop(
      provider.connection,
      rentPayerKeypair.publicKey,
      rentPayerFunds,
    )
    ;({ bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount,
      validatorIdentity,
    }))
  })

  afterEach(async () => {
    await rentPayerCleanup()
  })

  it('subscribe to notifications', async () => {
    await expect([
      'pnpm',
      [
        'cli',
        '-u',
        provider.connection.rpcEndpoint,
        '--program-id',
        program.programId.toBase58(),
        'subscribe',
        bondAccount.toBase58(),
        '--config',
        configAccount.toBase58(),
        '--type',
        'telegram',
        '--address',
        '@testuser',
        '--authority',
        validatorIdentityPath,
      ],
      {
        env: {
          ...process.env,
          NOTIFICATIONS_API_URL: testServer.baseUrl,
        },
      },
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      stdout: /Complete setup by opening this link/,
    })
  })

  it('unsubscribe from notifications', async () => {
    await expect([
      'pnpm',
      [
        'cli',
        '-u',
        provider.connection.rpcEndpoint,
        '--program-id',
        program.programId.toBase58(),
        'unsubscribe',
        bondAccount.toBase58(),
        '--config',
        configAccount.toBase58(),
        '--type',
        'telegram',
        '--authority',
        validatorIdentityPath,
      ],
      {
        env: {
          ...process.env,
          NOTIFICATIONS_API_URL: testServer.baseUrl,
        },
      },
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      stdout: /Successfully unsubscribed from telegram notifications/,
    })
  })

  it('show notifications', async () => {
    await expect([
      'pnpm',
      [
        'cli',
        '-u',
        provider.connection.rpcEndpoint,
        '--program-id',
        program.programId.toBase58(),
        'show-notifications',
        bondAccount.toBase58(),
        '--config',
        configAccount.toBase58(),
        '--authority',
        validatorIdentityPath,
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
      stdout: /telegram/,
    })
  })
})
