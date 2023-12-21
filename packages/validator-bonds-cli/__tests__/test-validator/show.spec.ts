import { AnchorProvider } from '@coral-xyz/anchor'
import { shellMatchers } from '@marinade.finance/jest-utils'
import YAML from 'yaml'
import {
  initConfigInstruction,
  findBondsWithdrawerAuthority,
  ValidatorBondsProgram,
} from '@marinade.finance/validator-bonds-sdk'
import { executeTxSimple } from '@marinade.finance/web3js-common'
import { transaction } from '@marinade.finance/anchor-common'
import { Keypair } from '@solana/web3.js'
import { initTest } from './utils'

beforeAll(() => {
  shellMatchers()
})

describe('Show command using CLI', () => {
  let provider: AnchorProvider
  let program: ValidatorBondsProgram

  beforeAll(async () => {
    shellMatchers()
    ;({ provider, program } = await initTest())
  })

  it('show config', async () => {
    const tx = await transaction(provider)
    const adminAuthority = Keypair.generate().publicKey
    const operatorAuthority = Keypair.generate().publicKey
    const { instruction: initConfigIx, keypair } = await initConfigInstruction({
      program,
      adminAuthority,
      operatorAuthority,
      epochsToClaimSettlement: 101,
      withdrawLockupEpochs: 102,
    })
    tx.add(initConfigIx)
    await executeTxSimple(provider.connection, tx, [provider.wallet, keypair!])

    const configAccountAddress = keypair!.publicKey
    const [, bondsWithdrawerAuthorityBump] = findBondsWithdrawerAuthority(
      configAccountAddress,
      program.programId
    )
    await (
      expect([
        'pnpm',
        [
          '--silent',
          'cli',
          '-u',
          provider.connection.rpcEndpoint,
          '--program-id',
          program.programId.toBase58(),
          'show-config',
          configAccountAddress.toBase58(),
          '-f',
          'yaml',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      signal: '',
      // stderr: '',
      stdout: YAML.stringify({
        programId: program.programId,
        publicKey: configAccountAddress.toBase58(),
        account: {
          adminAuthority: adminAuthority.toBase58(),
          operatorAuthority: operatorAuthority.toBase58(),
          epochsToClaimSettlement: 101,
          withdrawLockupEpochs: 102,
          minimumStakeLamports: 1000000000,
          bondsWithdrawerAuthorityBump,
          reserved: [512],
        },
      }),
    })

    await (
      expect([
        'pnpm',
        [
          '--silent',
          'cli',
          '-u',
          provider.connection.rpcEndpoint,
          '--program-id',
          program.programId.toBase58(),
          'show-config',
          '--admin',
          adminAuthority.toBase58(),
          '-f',
          'yaml',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      signal: '',
      // stderr: '',
      stdout: YAML.stringify([
        {
          programId: program.programId,
          publicKey: configAccountAddress.toBase58(),
          account: {
            adminAuthority: adminAuthority.toBase58(),
            operatorAuthority: operatorAuthority.toBase58(),
            epochsToClaimSettlement: 101,
            withdrawLockupEpochs: 102,
            minimumStakeLamports: 1000000000,
            bondsWithdrawerAuthorityBump,
            reserved: [512],
          },
        },
      ]),
    })

    await (
      expect([
        'pnpm',
        [
          '--silent',
          'cli',
          '-u',
          provider.connection.rpcEndpoint,
          '--program-id',
          program.programId.toBase58(),
          'show-config',
          '--admin',
          Keypair.generate().publicKey,
          '-f',
          'yaml',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      signal: '',
      // stderr: '',
      // nothing to be found, not-defined admin taken
      stdout: YAML.stringify([]),
    })

    await (
      expect([
        'pnpm',
        [
          '--silent',
          'cli',
          '-u',
          provider.connection.rpcEndpoint,
          '--program-id',
          program.programId.toBase58(),
          'show-config',
          '--operator',
          operatorAuthority.toBase58(),
          '-f',
          'yaml',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      signal: '',
      // stderr: '',
      stdout: YAML.stringify([
        {
          programId: program.programId,
          publicKey: configAccountAddress.toBase58(),
          account: {
            adminAuthority: adminAuthority.toBase58(),
            operatorAuthority: operatorAuthority.toBase58(),
            epochsToClaimSettlement: 101,
            withdrawLockupEpochs: 102,
            minimumStakeLamports: 1000000000,
            bondsWithdrawerAuthorityBump,
            reserved: [512],
          },
        },
      ]),
    })
  })
})
