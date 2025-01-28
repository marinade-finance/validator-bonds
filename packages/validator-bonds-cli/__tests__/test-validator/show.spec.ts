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
  U64_MAX,
  executeTxSimple,
  getVoteAccountFromData,
  signerWithPubkey,
  transaction,
  waitForNextEpoch,
} from '@marinade.finance/web3js-common'
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from '@solana/web3.js'
import { initTest } from '../../../validator-bonds-sdk/__tests__/test-validator/testValidator'
import {
  executeConfigureConfigInstruction,
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitWithdrawRequestInstruction,
} from '../../../validator-bonds-sdk/__tests__/utils/testTransactions'
import {
  createBondsFundedStakeAccount,
  createVoteAccount,
} from '../../../validator-bonds-sdk/__tests__/utils/staking'
import { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import { VoteAccountShow } from '../../src/commands/show'
import BN from 'bn.js'
import { claimWithdrawRequestInstruction } from '@marinade.finance/validator-bonds-sdk/src/instructions/claimWithdrawRequest'

beforeAll(() => {
  shellMatchers()
})

describe('Show command using CLI', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram

  beforeAll(async () => {
    shellMatchers()
    ;({ provider, program } = await initTest('processed'))
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
          minBondMaxStakeWanted: 0,
          reserved: [463],
        },
        bondsWithdrawerAuthority: bondsWithdrawerAuthority(
          configPubkey,
          program.programId,
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
            minBondMaxStakeWanted: 0,
            reserved: [463],
          },
          bondsWithdrawerAuthority: bondsWithdrawerAuthority(
            configPubkey,
            program.programId,
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
            minBondMaxStakeWanted: 0,
            reserved: [463],
          },
          bondsWithdrawerAuthority: bondsWithdrawerAuthority(
            configPubkey,
            program.programId,
          )[0].toBase58(),
        },
      ]),
    })
  })

  it('show bond', async () => {
    const { configAccount, adminAuthority } =
      await executeInitConfigInstruction({
        program,
        provider,
        epochsToClaimSettlement: 1,
        withdrawLockupEpochs: 2,
      })
    await executeConfigureConfigInstruction({
      program,
      provider,
      configAccount,
      adminAuthority,
      newMinBondMaxStakeWanted: 1000,
    })
    expect(
      await provider.connection.getAccountInfo(configAccount),
    ).not.toBeNull()
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
      maxStakeWanted: 2000 * LAMPORTS_PER_SOL,
    })

    const voteAccountShow = await loadTestingVoteAccount(
      provider.connection,
      voteAccount,
    )
    const expectedDataNoFunding = {
      programId: program.programId,
      publicKey: bondAccount.toBase58(),
      account: {
        config: configAccount.toBase58(),
        voteAccount: voteAccount.toBase58(),
        authority: bondAuthority.publicKey.toBase58(),
        costPerMillePerEpoch: '222 lamports',
        maxStakeWanted: '2000 SOLs',
      },
    }
    const expectedDataFundingSingleItem = {
      ...expectedDataNoFunding,
      voteAccount: voteAccountShow,
      amountOwned: '0 SOL',
      amountActive: '0 SOL',
      numberActiveStakeAccounts: 0,
      amountAtSettlements: '0 SOL',
      numberSettlementStakeAccounts: 0,
      amountToWithdraw: '0 SOL',
      withdrawRequest: '<NOT EXISTING>',
    }
    const expectedDataFundingMultipleItems = {
      ...expectedDataNoFunding,
      amountOwned: '0 SOL',
      amountActive: '0 SOL',
      numberActiveStakeAccounts: 0,
      amountAtSettlements: '0 SOL',
      numberSettlementStakeAccounts: 0,
      amountToWithdraw: '0 SOL',
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
      stdout: YAML.stringify(expectedDataFundingSingleItem),
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
      stdout: YAML.stringify(expectedDataFundingSingleItem),
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
      stdout: YAML.stringify([expectedDataFundingMultipleItems]),
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
      stdout: YAML.stringify([expectedDataFundingMultipleItems]),
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
      stdout:
        /Account of type bond or voteAccount or withdrawRequest was not found/,
    })
  })

  it('show funded bond', async () => {
    const withdrawLockupEpochs = 0
    const { configAccount } = await executeInitConfigInstruction({
      program,
      provider,
      epochsToClaimSettlement: 1,
      withdrawLockupEpochs,
    })
    expect(
      await provider.connection.getAccountInfo(configAccount),
    ).not.toBeNull()
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
      l => l * LAMPORTS_PER_SOL,
    )
    let lastStakeAccount: PublicKey
    const stakeAccounts: PublicKey[] = []
    const sumLamports = stakeAccountLamports.reduce((a, b) => a + b, 0)
    for (const lamports of stakeAccountLamports) {
      lastStakeAccount = await createBondsFundedStakeAccount({
        program,
        provider,
        configAccount,
        voteAccount,
        lamports,
      })
      stakeAccounts.push(lastStakeAccount)
    }

    const expectedDataNoFunding = {
      programId: program.programId,
      publicKey: bondAccount,
      account: {
        config: configAccount,
        voteAccount: voteAccount,
        authority: bondAuthority.publicKey,
        costPerMillePerEpoch: '1 lamport',
        maxStakeWanted: '0 SOL',
      },
    }
    const voteAccountShow = await loadTestingVoteAccount(
      provider.connection,
      voteAccount,
    )
    const expectedData = {
      ...expectedDataNoFunding,
      voteAccount: voteAccountShow,
      amountOwned: '0 SOL',
      amountActive: '0 SOL',
      numberActiveStakeAccounts: stakeAccountLamports.length,
      amountAtSettlements: '0 SOL',
      numberSettlementStakeAccounts: 0,
      amountToWithdraw: '0 SOL',
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
          '--with-funding',
          '--commitment',
          'processed',
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
        amountOwned: `${sumLamports / LAMPORTS_PER_SOL} SOLs`,
        amountActive: `${sumLamports / LAMPORTS_PER_SOL} SOLs`,
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
      withdrawRequestAccount,
    )
    const withdrawRequestAmount = withdrawRequestData.requestedAmount.toNumber()

    const expectedDataWithdrawRequestBefore = {
      ...expectedDataNoFunding,
      voteAccount: voteAccountShow,
      amountOwned: `${sumLamports / LAMPORTS_PER_SOL} SOLs`,
      amountActive: `${
        (sumLamports - withdrawRequestAmount) / LAMPORTS_PER_SOL
      } SOLs`,
      numberActiveStakeAccounts: stakeAccountLamports.length,
      amountAtSettlements: '0 SOL',
      numberSettlementStakeAccounts: 0,
      amountToWithdraw: `${withdrawRequestAmount / LAMPORTS_PER_SOL} SOLs`,
    }
    const expectedDataWithdrawRequestAfter = {
      withdrawRequest: {
        publicKey: withdrawRequestAccount.toBase58(),
        account: {
          voteAccount: withdrawRequestData.voteAccount.toBase58(),
          bond: bondAccount.toBase58(),
          epoch: (await provider.connection.getEpochInfo()).epoch,
          requestedAmount: `${withdrawRequestAmount / LAMPORTS_PER_SOL} SOLs`,
          withdrawnAmount: '0 SOL',
        },
      },
    }
    // waiting for next epoch to make sure the withdraw request claiming is over
    await waitForNextEpoch(provider.connection, 15)

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
      stdout: YAML.stringify({
        ...expectedDataWithdrawRequestBefore,
        ...expectedDataWithdrawRequestAfter,
      }),
    })

    // check show-bond to work with vote account, withdraw request addresses and stake account
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
          voteAccount.toBase58(),
          '--config',
          configAccount.toBase58(),
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
      stdout: YAML.stringify({
        ...expectedDataWithdrawRequestBefore,
        ...expectedDataWithdrawRequestAfter,
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
          'show-bond',
          withdrawRequestAccount.toBase58(),
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
      stdout: YAML.stringify({
        ...expectedDataWithdrawRequestBefore,
        ...expectedDataWithdrawRequestAfter,
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
          'show-bond',
          lastStakeAccount!.toBase58(),
          '--config',
          configAccount.toBase58(),
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
      stdout: new RegExp(
        `${lastStakeAccount!.toBase58()} is a STAKE ACCOUNT.*vote account ${voteAccount.toBase58()}`,
      ),
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
      stdout: YAML.stringify({
        ...expectedData,
        amountOwned: `${sumLamports / LAMPORTS_PER_SOL} SOLs`,
        amountActive: `${sumLamports / LAMPORTS_PER_SOL} SOLs`,
      }),
    })

    // withdraw what's possible, i.e., ALL
    const epoch2 = (await provider.connection.getEpochInfo()).epoch
    const bnLamportsPerSol = new BN(LAMPORTS_PER_SOL)
    const { div: activeDiv, mod: activeMod } = new BN(sumLamports)
      .sub(U64_MAX)
      .divmod(bnLamportsPerSol)
    const withdrawingAmount =
      stakeAccountLamports[stakeAccountLamports.length - 1]
    const { div: withdrawingDiv } = new BN(withdrawingAmount).divmod(
      bnLamportsPerSol,
    )
    // sum of all numbers in stakeAccountLamports.
    const leftStakeAccountAmount = new BN(
      stakeAccountLamports.reduce((a, b) => a + b, 0) - withdrawingAmount,
    )
      .div(bnLamportsPerSol)
      .toNumber()
    const { withdrawRequestAccount: toWithdrawRequestAcc } =
      await executeInitWithdrawRequestInstruction({
        program,
        provider,
        configAccount,
        bondAccount,
        validatorIdentity,
        amount: U64_MAX,
      })
    await waitForNextEpoch(provider.connection, 15)
    const { instruction, splitStakeAccount } =
      await claimWithdrawRequestInstruction({
        program,
        authority: bondAuthority,
        withdrawRequestAccount: toWithdrawRequestAcc,
        bondAccount,
        stakeAccount: lastStakeAccount!,
      })
    await provider.sendIx([bondAuthority, splitStakeAccount], instruction)
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
      stdout: YAML.stringify({
        ...expectedData,
        amountOwned: `${leftStakeAccountAmount} SOLs`,
        amountActive: `${activeDiv.toString()}.${activeMod
          .muln(-1)
          .toString()
          .padStart(9, '0')} SOLs`,
        amountToWithdraw: `${leftStakeAccountAmount.toString()} SOLs`,
        numberActiveStakeAccounts: stakeAccountLamports.length - 1,
        withdrawRequest: {
          publicKey: withdrawRequestAccount.toBase58(),
          account: {
            voteAccount: withdrawRequestData.voteAccount.toBase58(),
            bond: bondAccount.toBase58(),
            epoch: epoch2,
            requestedAmount: '<ALL>',
            withdrawnAmount: `${withdrawingDiv.toString()} SOLs`,
          },
        },
      }),
    })
  })
})

async function loadTestingVoteAccount(
  connection: Connection,
  voteAccount: PublicKey,
): Promise<VoteAccountShow> {
  const voteAccountInfo = await connection.getAccountInfo(voteAccount)
  expect(voteAccountInfo).not.toBeNull()
  const voteAccountData = getVoteAccountFromData(voteAccount, voteAccountInfo!)
    .account.data
  return {
    nodePubkey: voteAccountData.nodePubkey,
    authorizedWithdrawer: voteAccountData.authorizedWithdrawer,
    commission: voteAccountData.commission,
  }
}
