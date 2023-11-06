import { AnchorProvider } from '@coral-xyz/anchor'
import { shellMatchers } from '@marinade.finance/jest-utils'
import YAML from 'yaml'
import {
  getProgram,
  initConfigInstruction,
  VALIDATOR_BONDS_PROGRAM_ID,
} from '@marinade.finance/validator-bonds-sdk'
import { executeTxSimple } from '@marinade.finance/web3js-common'
import { transaction } from '@marinade.finance/anchor-common'
import { Keypair } from '@solana/web3.js'

beforeAll(() => {
  shellMatchers()
})

describe('Show command using CLI', () => {
  const provider = AnchorProvider.env()
  provider.opts.skipPreflight = true
  provider.opts.commitment = 'confirmed'
  const program = getProgram({
    connection: provider.connection,
    wallet: provider.wallet,
    opts: provider.opts,
    programId: VALIDATOR_BONDS_PROGRAM_ID,
  })

  it('show config', async () => {
    const tx = await transaction(provider)
    const adminAuthority = Keypair.generate().publicKey
    const operatorAuthority = Keypair.generate().publicKey
    const { instruction: initConfigIx, keypair } = await initConfigInstruction({
      program,
      adminAuthority,
      operatorAuthority,
      claimSettlementAfterEpochs: 101,
      withdrawLockupEpochs: 102,
    })
    tx.add(initConfigIx)
    await executeTxSimple(provider.connection, tx, [provider.wallet, keypair!])

    const configAccountAddress = keypair!.publicKey
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
          claimSettlementAfterEpochs: 101,
          withdrawLockupEpochs: 102,
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
            claimSettlementAfterEpochs: 101,
            withdrawLockupEpochs: 102,
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
            claimSettlementAfterEpochs: 101,
            withdrawLockupEpochs: 102,
          },
        },
      ]),
    })
  })
})
