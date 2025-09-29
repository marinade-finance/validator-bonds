import assert from 'assert'

import { extendJestWithShellMatchers } from '@marinade.finance/jest-shell-matcher'
import { getConfig } from '@marinade.finance/validator-bonds-sdk'
import { initTest } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testValidator'
import { executeInitConfigInstruction } from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/testTransactions'
import { createTempFileKeypair } from '@marinade.finance/web3js-1x'
import { Keypair, PublicKey } from '@solana/web3.js'

import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import type { ValidatorBondsProgram } from '@marinade.finance/validator-bonds-sdk'

describe('Configure config account using CLI', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let adminPath: string
  let adminKeypair: Keypair
  let adminCleanup: () => Promise<void>
  let configAccount: PublicKey
  let operatorAuthority: Keypair

  beforeAll(() => {
    extendJestWithShellMatchers()
    ;({ provider, program } = initTest())
  })

  beforeEach(async () => {
    ;({
      path: adminPath,
      keypair: adminKeypair,
      cleanup: adminCleanup,
    } = await createTempFileKeypair())
    ;({ configAccount, operatorAuthority } = await executeInitConfigInstruction(
      {
        program,
        provider,
        adminAuthority: adminKeypair,
        epochsToClaimSettlement: 1,
        slotsToStartSettlementClaiming: 3,
        withdrawLockupEpochs: 2,
      },
    ))
    assert((await provider.connection.getAccountInfo(configAccount)) != null)
  })

  afterEach(async () => {
    await adminCleanup()
  })

  it('configure config account', async () => {
    const newAdmin = Keypair.generate()

    await expect([
      'pnpm',
      [
        'cli',
        '-u',
        provider.connection.rpcEndpoint,
        '--program-id',
        program.programId.toBase58(),
        'configure-config',
        configAccount.toBase58(),
        '--admin-authority',
        adminPath,
        '--confirmation-finality',
        'confirmed',
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 200,
      // stderr: '',
      stdout: /no new property to configure/,
    })

    await expect([
      'pnpm',
      [
        'cli',
        '-u',
        provider.connection.rpcEndpoint,
        '--program-id',
        program.programId.toBase58(),
        'configure-config',
        configAccount.toBase58(),
        '--admin-authority',
        adminPath,
        '--operator',
        PublicKey.default.toBase58(),
        '--admin',
        newAdmin.publicKey.toBase58(),
        '--pause-authority',
        PublicKey.default.toBase58(),
        '--epochs-to-claim-settlement',
        111,
        '--slots-to-start-settlement-claiming',
        143,
        '--withdraw-lockup-epochs',
        112,
        '--minimum-stake-lamports',
        134,
        '--min-bond-max-stake-wanted',
        111,
        '--confirmation-finality',
        'confirmed',
        '-v',
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /successfully configured/,
    })

    const configData = await getConfig(program, configAccount)
    expect(configData.adminAuthority).toEqual(newAdmin.publicKey)
    expect(configData.operatorAuthority).toEqual(PublicKey.default)
    expect(configData.pauseAuthority).toEqual(PublicKey.default)
    expect(configData.epochsToClaimSettlement).toEqual(111)
    expect(configData.slotsToStartSettlementClaiming).toEqual(143)
    expect(configData.withdrawLockupEpochs).toEqual(112)
    expect(configData.minimumStakeLamports).toEqual(134)
    expect(configData.minBondMaxStakeWanted).toEqual(111)
  })

  it('configure config in print-only mode', async () => {
    await expect([
      'pnpm',
      [
        'cli',
        '-u',
        provider.connection.rpcEndpoint,
        'configure-config',
        configAccount.toBase58(),
        '--admin-authority',
        adminKeypair.publicKey.toBase58(),
        '--operator',
        PublicKey.default.toBase58(),
        '--minimum-stake-lamports',
        0,
        '--print-only',
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /successfully configured/,
    })
    expect((await getConfig(program, configAccount)).operatorAuthority).toEqual(
      operatorAuthority.publicKey,
    )
  })
})
