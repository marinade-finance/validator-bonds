import { shellMatchers } from '@marinade.finance/jest-utils'
import YAML from 'yaml'
import {
  initConfigInstruction,
  ValidatorBondsProgram,
  getWithdrawRequest,
  cancelWithdrawRequestInstruction,
  bondsWithdrawerAuthority,
} from '@marinade.finance/validator-bonds-sdk'
import {
  executeTxSimple,
  signerWithPubkey,
  transaction,
} from '@marinade.finance/web3js-common'
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { initTest } from '@marinade.finance/validator-bonds-sdk/__tests__/test-validator/testValidator'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitWithdrawRequestInstruction,
} from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testTransactions'
import {
  createBondsFundedStakeAccount,
  createVoteAccount,
} from '@marinade.finance/validator-bonds-sdk/__tests__/utils/staking'
import { AnchorExtendedProvider } from '@marinade.finance/anchor-common'

beforeAll(() => {
  shellMatchers()
})

describe('Show command using CLI', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram

  beforeAll(async () => {
    shellMatchers()
    ;({ provider, program } = await initTest())
  })

  it('show config', async () => {
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
          configPubkey.toBase58(),
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
        publicKey: configPubkey.toBase58(),
        account: {
          adminAuthority: admin.toBase58(),
          operatorAuthority: operator.toBase58(),
          epochsToClaimSettlement: 101,
          withdrawLockupEpochs: 103,
          minimumStakeLamports: LAMPORTS_PER_SOL,
          pauseAuthority: admin.toBase58(),
          paused: false,
          slotsToStartSettlementClaiming: 102,
          reserved: [471],
        },
        bondsWithdrawerAuthority: bondsWithdrawerAuthority(
          configPubkey,
          program.programId
        )[0].toBase58(),
      }),
    })

    await (
      expect([
        'pnpm',
        [
          '--silent',
          'cli',
          // for show commands there is ok to provide a non-existing keypair
          '--keypair',
          '/a/b/c/d/e/f/g',
          '-u',
          provider.connection.rpcEndpoint,
          '--program-id',
          program.programId.toBase58(),
          'show-config',
          '--admin',
          admin.toBase58(),
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
          publicKey: configPubkey.toBase58(),
          account: {
            adminAuthority: admin.toBase58(),
            operatorAuthority: operator.toBase58(),
            epochsToClaimSettlement: 101,
            withdrawLockupEpochs: 103,
            minimumStakeLamports: LAMPORTS_PER_SOL,
            pauseAuthority: admin.toBase58(),
            paused: false,
            slotsToStartSettlementClaiming: 102,
            reserved: [471],
          },
          bondsWithdrawerAuthority: bondsWithdrawerAuthority(
            configPubkey,
            program.programId
          )[0].toBase58(),
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
          operator.toBase58(),
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
          publicKey: configPubkey.toBase58(),
          account: {
            adminAuthority: admin.toBase58(),
            operatorAuthority: operator.toBase58(),
            epochsToClaimSettlement: 101,
            withdrawLockupEpochs: 103,
            minimumStakeLamports: LAMPORTS_PER_SOL,
            pauseAuthority: admin.toBase58(),
            paused: false,
            slotsToStartSettlementClaiming: 102,
            reserved: [471],
          },
          bondsWithdrawerAuthority: bondsWithdrawerAuthority(
            configPubkey,
            program.programId
          )[0].toBase58(),
        },
      ]),
    })
  })

  it('show bond', async () => {
    const { configAccount } = await executeInitConfigInstruction({
      program,
      provider,
      epochsToClaimSettlement: 1,
      withdrawLockupEpochs: 2,
    })
    expect(
      provider.connection.getAccountInfo(configAccount)
    ).resolves.not.toBeNull()
    const { voteAccount, validatorIdentity } = await createVoteAccount({
      provider,
    })
    const bondAuthority = Keypair.generate()
    const { bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      bondAuthority,
      voteAccount,
      validatorIdentity,
      cpmpe: 222,
    })

    const expectedDataNoFunding = {
      programId: program.programId,
      publicKey: bondAccount.toBase58(),
      account: {
        config: configAccount.toBase58(),
        voteAccount: voteAccount.toBase58(),
        authority: bondAuthority.publicKey.toBase58(),
      },
    }
    const expectedData = {
      ...expectedDataNoFunding,
      amountActive: 0,
      amountAtSettlements: 0,
      amountToWithdraw: 0,
      numberActiveStakeAccounts: 0,
      numberSettlementStakeAccounts: 0,
      withdrawRequest: '<NOT EXISTING>',
    }

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
          'show-bond',
          bondAccount.toBase58(),
          '-f',
          'yaml',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      signal: '',
      // stderr: '',
      stdout: YAML.stringify(expectedData),
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
          'show-bond',
          '--config',
          configAccount.toBase58(),
          voteAccount.toBase58(),
          '-f',
          'yaml',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      signal: '',
      // stderr: '',
      stdout: YAML.stringify(expectedData),
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
          'show-bond',
          '--config',
          configAccount.toBase58(),
          '-f',
          'yaml',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      signal: '',
      // stderr: '',
      stdout: YAML.stringify([expectedDataNoFunding]),
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
          'show-bond',
          '--config',
          configAccount.toBase58(),
          '-f',
          'yaml',
          '--with-funding',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      signal: '',
      // stderr: '',
      stdout: YAML.stringify([expectedData]),
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
          'show-bond',
          '--bond-authority',
          bondAuthority.publicKey.toBase58(),
          '-f',
          'yaml',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      signal: '',
      // stderr: '',
      stdout: YAML.stringify([expectedDataNoFunding]),
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
          'show-bond',
          '--config',
          configAccount.toBase58(),
          '--bond-authority',
          bondAuthority.publicKey.toBase58(),
          '--with-funding',
          '-f',
          'yaml',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      signal: '',
      // stderr: '',
      stdout: YAML.stringify([expectedData]),
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
          'show-bond',
          Keypair.generate().publicKey,
          '-f',
          'yaml',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 1,
      signal: '',
      // stderr: '',
      stdout: /Account of type bond or voteAccount was not found/,
    })
  })

  it('show funded bond', async () => {
    const { configAccount } = await executeInitConfigInstruction({
      program,
      provider,
      epochsToClaimSettlement: 1,
      withdrawLockupEpochs: 2,
    })
    expect(
      provider.connection.getAccountInfo(configAccount)
    ).resolves.not.toBeNull()
    const { voteAccount, validatorIdentity } = await createVoteAccount({
      provider,
    })
    const bondAuthority = Keypair.generate()
    const { bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      bondAuthority,
      voteAccount,
      validatorIdentity,
      cpmpe: 1,
    })
    const stakeAccountLamports: number[] = [3, 10, 23].map(
      l => l * LAMPORTS_PER_SOL
    )
    const sumLamports = stakeAccountLamports.reduce((a, b) => a + b, 0)
    for (const lamports of stakeAccountLamports) {
      await createBondsFundedStakeAccount({
        program,
        provider,
        configAccount,
        voteAccount,
        lamports,
      })
    }

    const expectedDataNoFunding = {
      programId: program.programId,
      publicKey: bondAccount,
      account: {
        config: configAccount,
        voteAccount: voteAccount,
        authority: bondAuthority.publicKey,
      },
    }
    const expectedData = {
      ...expectedDataNoFunding,
      amountActive: 0,
      amountAtSettlements: 0,
      amountToWithdraw: 0,
      numberActiveStakeAccounts: stakeAccountLamports.length,
      numberSettlementStakeAccounts: 0,
      withdrawRequest: '<NOT EXISTING>',
    }

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
          'show-bond',
          bondAccount.toBase58(),
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
        ...expectedData,
        amountActive: sumLamports,
      }),
    })

    const { withdrawRequestAccount } =
      await executeInitWithdrawRequestInstruction({
        program,
        provider,
        configAccount,
        bondAccount,
        validatorIdentity,
        amount: LAMPORTS_PER_SOL * 2,
      })
    const withdrawRequestData = await getWithdrawRequest(
      program,
      withdrawRequestAccount
    )
    const withdrawRequestAmount = withdrawRequestData.requestedAmount.toNumber()

    const epoch = (await provider.connection.getEpochInfo()).epoch
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
          'show-bond',
          bondAccount.toBase58(),
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
        ...expectedData,
        amountActive: sumLamports - withdrawRequestAmount,
        amountToWithdraw: withdrawRequestAmount,
        withdrawRequest: {
          publicKey: withdrawRequestAccount.toBase58(),
          account: {
            voteAccount: withdrawRequestData.voteAccount.toBase58(),
            bond: bondAccount.toBase58(),
            epoch,
            requestedAmount: withdrawRequestAmount,
            withdrawnAmount: 0,
          },
        },
      }),
    })

    const { instruction: ixCancel } = await cancelWithdrawRequestInstruction({
      program,
      withdrawRequestAccount,
      authority: validatorIdentity,
      bondAccount,
      voteAccount,
    })
    await provider.sendIx([validatorIdentity], ixCancel)
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
          'show-bond',
          bondAccount.toBase58(),
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
        ...expectedData,
        amountActive: sumLamports,
      }),
    })
  })
})
