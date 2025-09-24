import assert from 'assert'

import { extendJestWithShellMatchers } from '@marinade.finance/jest-shell-matcher'
import { rand } from '@marinade.finance/ts-common'
import {
  getBondsFunding,
  getStakeAccount,
  withdrawRequestAddress,
  MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
} from '@marinade.finance/validator-bonds-sdk'
import { initTest } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testValidator'
import {
  createBondsFundedStakeAccount,
  createVoteAccount,
} from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/staking'
import {
  executeCancelWithdrawRequestInstruction,
  executeInitBondInstruction,
  executeInitWithdrawRequestInstruction,
} from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/testTransactions'
import {
  createTempFileKeypair,
  createUserAndFund,
  pubkey,
  waitForNextEpoch,
} from '@marinade.finance/web3js-1x'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import BN from 'bn.js'

import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import type { ValidatorBondsProgram } from '@marinade.finance/validator-bonds-sdk'
import type { Keypair, PublicKey } from '@solana/web3.js'

describe('Claim withdraw request using CLI (institutional)', () => {
  let withdrawRequestLamports: BN
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let bondAccount: PublicKey
  let voteAccount: PublicKey
  let validatorIdentityPath: string
  let validatorIdentityKeypair: Keypair
  let validatorIdentityCleanup: () => Promise<void>

  beforeAll(() => {
    extendJestWithShellMatchers()
    ;({ provider, program } = initTest())
  })

  beforeEach(async () => {
    withdrawRequestLamports = new BN(LAMPORTS_PER_SOL * rand(123, 10))
    ;({
      path: validatorIdentityPath,
      keypair: validatorIdentityKeypair,
      cleanup: validatorIdentityCleanup,
    } = await createTempFileKeypair())
    assert(
      (await provider.connection.getAccountInfo(
        MARINADE_INSTITUTIONAL_CONFIG_ADDRESS
      )) !== null
    )
    ;({ voteAccount } = await createVoteAccount({
      provider,
      validatorIdentity: validatorIdentityKeypair,
    }))
    ;({ bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
      voteAccount,
    }))
    try {
      const [withdrawRequestAddr] = withdrawRequestAddress(
        bondAccount,
        program.programId
      )
      await executeCancelWithdrawRequestInstruction(
        program,
        provider,
        withdrawRequestAddr,
        validatorIdentityKeypair
      )
    } catch (_e) {
      // ignore
    }
    await executeInitWithdrawRequestInstruction({
      program,
      provider,
      configAccount: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
      bondAccount,
      validatorIdentity: validatorIdentityKeypair,
      amount: withdrawRequestLamports,
    })
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
        configAccount: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
        lamports: toFund,
        voteAccount,
      })
      stakeAccountSumBalance = stakeAccountSumBalance.add(
        (await getStakeAccount(provider, sa)).balanceLamports ?? new BN(0)
      )
    }

    const bondsFunding = await getBondsFunding({
      program,
      configAccount: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
      bondAccounts: [bondAccount],
    })
    expect(bondsFunding.length).toEqual(1)
    expect(bondsFunding[0]?.numberActiveStakeAccounts).toEqual(
      stakeAccountNumber
    )
    expect(stakeAccountSumBalance).toEqual(toFund.muln(stakeAccountNumber))
    const expectedActive = toFund
      .muln(stakeAccountNumber)
      .sub(withdrawRequestLamports)
    expect(bondsFunding[0]?.amountActive).toEqual(expectedActive)

    const user = await createUserAndFund({ provider })

    // waiting for next epoch, otherwise the merge fails as stake accounts are in different states (0x6)
    // + needed to wait 1 epoch for the withdraw request to be claimable (config set 'withdrawLockupEpochs' to 0)
    await waitForNextEpoch(provider.connection, 15)

    await expect([
      'pnpm',
      [
        'cli:institutional',
        '-u',
        provider.connection.rpcEndpoint,
        'claim-withdraw-request',
        voteAccount.toBase58(),
        '--authority',
        validatorIdentityPath,
        '--withdrawer',
        pubkey(user).toBase58(),
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /successfully claimed/,
    })
  })
})
