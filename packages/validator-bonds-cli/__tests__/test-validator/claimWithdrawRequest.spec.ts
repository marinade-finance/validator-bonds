import {
  createTempFileKeypair,
  createUserAndFund,
  pubkey,
  waitForNextEpoch,
} from '@marinade.finance/web3js-common'
import { shellMatchers } from '@marinade.finance/jest-utils'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  getBondsFunding,
  getStakeAccount,
  findStakeAccounts,
  getWithdrawRequest,
  cancelWithdrawRequestInstruction,
  withdrawRequestAddress,
} from '@marinade.finance/validator-bonds-sdk'
import {
  executeCancelWithdrawRequestInstruction,
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitWithdrawRequestInstruction,
} from '../../../validator-bonds-sdk/__tests__/utils/testTransactions'
import { initTest } from '../../../validator-bonds-sdk/__tests__/test-validator/testValidator'
import {
  createBondsFundedStakeAccount,
  createVoteAccount,
} from '../../../validator-bonds-sdk/__tests__/utils/staking'
import { rand } from '@marinade.finance/ts-common'
import { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import BN from 'bn.js'

describe('Claim withdraw request using CLI', () => {
  let withdrawRequestLamports: BN
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let bondAccount: PublicKey
  let voteAccount: PublicKey
  let withdrawRequestAccount: PublicKey
  let validatorIdentityPath: string
  let validatorIdentityKeypair: Keypair
  let validatorIdentityCleanup: () => Promise<void>

  beforeAll(async () => {
    shellMatchers()
    ;({ provider, program } = await initTest())
  })

  beforeEach(async () => {
    withdrawRequestLamports = new BN(LAMPORTS_PER_SOL * rand(123, 10))
    ;({
      path: validatorIdentityPath,
      keypair: validatorIdentityKeypair,
      cleanup: validatorIdentityCleanup,
    } = await createTempFileKeypair())
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
      withdrawLockupEpochs: 0,
    }))
    expect(
      await provider.connection.getAccountInfo(configAccount),
    ).not.toBeNull()
    ;({ voteAccount } = await createVoteAccount({
      provider,
      validatorIdentity: validatorIdentityKeypair,
    }))
    ;({ bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount,
    }))
    try {
      const [withdrawRequestAddr] = withdrawRequestAddress(
        bondAccount,
        program.programId,
      )
      await executeCancelWithdrawRequestInstruction(
        program,
        provider,
        withdrawRequestAddr,
        validatorIdentityKeypair,
      )
    } catch (e) {
      // ignore
    }
    ;({ withdrawRequestAccount } = await executeInitWithdrawRequestInstruction({
      program,
      provider,
      configAccount,
      bondAccount,
      validatorIdentity: validatorIdentityKeypair,
      amount: withdrawRequestLamports,
    }))
  })

  afterEach(async () => {
    await validatorIdentityCleanup()
  })

  it('claim withdraw request', async () => {
    const stakeAccountNumber = 10
    const toFund = withdrawRequestLamports.divn(stakeAccountNumber - 3)
    let stakeAccountSumBalance = new BN(0)
    for (let i = 0; i < stakeAccountNumber; i++) {
      const sa = await createBondsFundedStakeAccount({
        program,
        provider,
        configAccount,
        lamports: toFund,
        voteAccount,
      })
      stakeAccountSumBalance = stakeAccountSumBalance.add(
        (await getStakeAccount(provider, sa)).balanceLamports ?? new BN(0),
      )
    }

    const bondsFunding = await getBondsFunding({
      program,
      configAccount,
      bondAccounts: [bondAccount],
    })
    expect(bondsFunding.length).toEqual(1)
    expect(bondsFunding[0].numberActiveStakeAccounts).toEqual(
      stakeAccountNumber,
    )
    expect(stakeAccountSumBalance).toEqual(toFund.muln(stakeAccountNumber))
    const expectedActive = toFund
      .muln(stakeAccountNumber)
      .sub(withdrawRequestLamports)
    expect(expectedActive).toEqual(bondsFunding[0].amountActive)

    const user = await createUserAndFund({ provider })

    // waiting for next epoch, otherwise the merge fails as stake accounts are in different states (0x6)
    // + needed to wait 1 epoch for the withdraw request to be claimable (config set 'withdrawLockupEpochs' to 0)
    await waitForNextEpoch(provider.connection, 15)

    await (
      expect([
        'pnpm',
        [
          'cli',
          '-u',
          provider.connection.rpcEndpoint,
          '--program-id',
          program.programId.toBase58(),
          'claim-withdraw-request',
          voteAccount.toBase58(),
          '--config',
          configAccount.toBase58(),
          '--authority',
          validatorIdentityPath,
          '--withdrawer',
          pubkey(user).toBase58(),
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /successfully claimed/,
    })

    // second claim will not fail
    await (
      expect([
        'pnpm',
        [
          'cli',
          '-u',
          provider.connection.rpcEndpoint,
          '--program-id',
          program.programId.toBase58(),
          'claim-withdraw-request',
          voteAccount.toBase58(),
          '--config',
          configAccount.toBase58(),
          '--authority',
          validatorIdentityPath,
          '--withdrawer',
          pubkey(user).toBase58(),
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /has been fully withdrawn/,
    })

    const userStakeAccounts = await findStakeAccounts({
      connection: program,
      staker: pubkey(user),
      withdrawer: pubkey(user),
    })
    expect(userStakeAccounts.length).toEqual(1)
    expect(userStakeAccounts[0].account.lamports).toEqual(
      withdrawRequestLamports,
    )
    const withdrawRequestData = await getWithdrawRequest(
      program,
      withdrawRequestAccount,
    )
    expect(withdrawRequestData.requestedAmount).toEqual(withdrawRequestLamports)
    expect(withdrawRequestData.withdrawnAmount).toEqual(withdrawRequestLamports)

    // --- let's claim again with active and activating stake account
    const { instruction: ixCancel } = await cancelWithdrawRequestInstruction({
      program,
      withdrawRequestAccount,
      authority: validatorIdentityKeypair,
      bondAccount,
      voteAccount,
    })
    await provider.sendIx([validatorIdentityKeypair], ixCancel)
    ;({ withdrawRequestAccount } = await executeInitWithdrawRequestInstruction({
      program,
      provider,
      configAccount,
      bondAccount,
      validatorIdentity: validatorIdentityKeypair,
      amount: Number.MAX_SAFE_INTEGER,
    }))
    // waiting for next epoch for withdraw request to be claimable
    await waitForNextEpoch(provider.connection, 15)
    const activeStake = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      lamports: LAMPORTS_PER_SOL * 100,
      voteAccount,
    })
    await (
      expect([
        'pnpm',
        [
          'cli',
          '-u',
          provider.connection.rpcEndpoint,
          '--program-id',
          program.programId.toBase58(),
          'claim-withdraw-request',
          withdrawRequestAccount.toBase58(),
          '--config',
          configAccount.toBase58(),
          '--authority',
          validatorIdentityPath,
          '--withdrawer',
          pubkey(user).toBase58(),
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /successfully claimed/,
    })

    // expected merging of stake accounts happened, ser has to have 3 stake accounts:
    //  - 1 stake account from the first claim (all merged)
    //  - 2 more from the second claim (all the rest merged besides the activeStake)
    const userStakeAccountsMerged = await findStakeAccounts({
      connection: program,
      staker: pubkey(user),
      withdrawer: pubkey(user),
    })
    expect(userStakeAccountsMerged.length).toEqual(3)
    expect(
      userStakeAccountsMerged.filter(s => s.publicKey.equals(activeStake))
        .length,
    ).toEqual(1)
  })

  it('claim withdraw request with stake account', async () => {
    const stakeAccount = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      lamports: withdrawRequestLamports,
      voteAccount,
    })

    const user = await createUserAndFund({ provider })

    // waiting for next epoch, otherwise the merge fails as stake accounts are in different states (0x6)
    // + needed to wait 1 epoch for the withdraw request to be claimable (config set 'withdrawLockupEpochs' to 0)
    await waitForNextEpoch(provider.connection, 15)

    await (
      expect([
        'pnpm',
        [
          'cli',
          '-u',
          provider.connection.rpcEndpoint,
          '--program-id',
          program.programId.toBase58(),
          'claim-withdraw-request',
          voteAccount.toBase58(),
          '--config',
          configAccount.toBase58(),
          '--authority',
          validatorIdentityPath,
          '--withdrawer',
          pubkey(user).toBase58(),
          '--stake-account',
          stakeAccount.toBase58(),
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /successfully claimed/,
    })
  })

  it('claim withdraw request in print-only mode', async () => {
    await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      lamports: withdrawRequestLamports.sub(new BN(LAMPORTS_PER_SOL)),
      voteAccount,
    })

    await (
      expect([
        'pnpm',
        [
          'cli',
          '-u',
          provider.connection.rpcEndpoint,
          '--program-id',
          program.programId.toBase58(),
          'claim-withdraw-request',
          withdrawRequestAccount.toBase58(),
          '--config',
          configAccount.toBase58(),
          '--authority',
          validatorIdentityPath,
          '--print-only',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /successfully claimed/,
    })
  })
})
