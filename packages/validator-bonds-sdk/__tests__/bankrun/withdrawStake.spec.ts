import { verifyError } from '@marinade.finance/anchor-common'
import {
  assertNotExist,
  currentEpoch,
  warpToNextEpoch,
} from '@marinade.finance/bankrun-utils'
import { createUserAndFund, signer } from '@marinade.finance/web3js-1x'
import { Keypair, LAMPORTS_PER_SOL, StakeProgram } from '@solana/web3.js'

import { initBankrunTest } from './bankrun'
import {
  Errors,
  bondsWithdrawerAuthority,
  getRentExemptStake,
  resetStakeInstruction,
  settlementStakerAuthority,
  withdrawStakeInstruction,
} from '../../src'
import {
  authorizeStakeAccount,
  createBondsFundedStakeAccount,
  createSettlementFundedDelegatedStake,
  createSettlementFundedInitializedStake,
  createVoteAccount,
  delegatedStakeAccount,
} from '../utils/staking'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '../utils/testTransactions'

import type { ValidatorBondsProgram } from '../../src'
import type { BankrunExtendedProvider } from '@marinade.finance/bankrun-utils'
import type { SignerType } from '@marinade.finance/web3js-1x'
import type { PublicKey } from '@solana/web3.js'

describe('Validator Bonds withdraw stake', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let operatorAuthority: Keypair
  let validatorIdentity: Keypair
  let voteAccount: PublicKey
  let user: SignerType

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
  })

  beforeEach(async () => {
    ;({ configAccount, operatorAuthority } = await executeInitConfigInstruction(
      {
        program,
        provider,
      },
    ))
    ;({ voteAccount, validatorIdentity } = await createVoteAccount({
      provider,
    }))
    await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount,
      validatorIdentity,
    })
    user = signer(
      await createUserAndFund({ provider, lamports: LAMPORTS_PER_SOL }),
    )
  })

  // Creates a settlement-funded DELEGATED stake that is fully deactivated (inactive).
  // A sub-minimal delegated stake cannot be made with a real DelegateStake (that rejection
  // is the bug itself), so we delegate >= 1 SOL, activate, deactivate, cool down, optionally
  // withdraw down to dust, then re-authorize to the bonds/settlement PDAs.
  // Side effect: advances ~2 epochs on the shared provider clock.
  async function fundedDeactivatedDelegatedStake(
    settlement: PublicKey,
    initialLamports: number,
    withdrawDownTo?: number,
  ): Promise<PublicKey> {
    const [bondsAuth] = bondsWithdrawerAuthority(configAccount, program.programId)
    const [settlementAuth] = settlementStakerAuthority(
      settlement,
      program.programId,
    )
    const { stakeAccount, staker, withdrawer } = await delegatedStakeAccount({
      provider,
      lamports: initialLamports,
      voteAccountToDelegate: voteAccount,
    })
    await warpToNextEpoch(provider) // activate
    await provider.sendIx(
      [staker],
      StakeProgram.deactivate({
        stakePubkey: stakeAccount,
        authorizedPubkey: staker.publicKey,
      }),
    )
    await warpToNextEpoch(provider) // deactivation completes -> fully inactive
    if (withdrawDownTo !== undefined) {
      const cur = (await provider.connection.getAccountInfo(stakeAccount))!
        .lamports
      await provider.sendIx(
        [withdrawer],
        StakeProgram.withdraw({
          stakePubkey: stakeAccount,
          authorizedPubkey: withdrawer.publicKey,
          toPubkey: provider.walletPubkey,
          lamports: cur - withdrawDownTo,
        }),
      )
    }
    await authorizeStakeAccount({
      provider,
      authority: withdrawer,
      stakeAccount,
      withdrawer: bondsAuth,
      staker: settlementAuth,
    })
    return stakeAccount
  }

  it('withdraw settlement operator stake account', async () => {
    const fakeSettlement = Keypair.generate().publicKey
    const stakeAccount = await createSettlementFundedInitializedStake({
      program,
      provider,
      configAccount,
      settlementAccount: fakeSettlement,
      lamports: LAMPORTS_PER_SOL,
    })
    const { instruction } = await withdrawStakeInstruction({
      program,
      configAccount,
      stakeAccount,
      operatorAuthority: operatorAuthority.publicKey,
      settlementAccount: fakeSettlement,
      withdrawTo: user.publicKey,
    })
    await provider.sendIx([operatorAuthority], instruction)
    await assertNotExist(provider, stakeAccount)
    expect(
      (await provider.connection.getAccountInfo(user.publicKey))?.lamports,
    ).toEqual(2 * LAMPORTS_PER_SOL)
  })

  it('cannot withdraw settlement operator stake when delegated and active', async () => {
    // active delegated stake is live validator collateral -> must NOT be withdrawable
    const fakeSettlement = Keypair.generate().publicKey
    const stakeAccount = await createSettlementFundedDelegatedStake({
      program,
      provider,
      configAccount,
      settlementAccount: fakeSettlement,
      lamports: LAMPORTS_PER_SOL * 2,
      voteAccount,
    })
    const { instruction } = await withdrawStakeInstruction({
      program,
      configAccount,
      stakeAccount,
      operatorAuthority: operatorAuthority.publicKey,
      settlementAccount: fakeSettlement,
      withdrawTo: user.publicKey,
    })
    try {
      await provider.sendIx([operatorAuthority], instruction)
      throw new Error('Expected error; stake is delegated and not deactivated')
    } catch (e) {
      verifyError(e, Errors, 6079, 'not fully deactivated')
    }
    expect(
      await provider.connection.getAccountInfo(stakeAccount),
    ).not.toBeNull()
    expect(
      (await provider.connection.getAccountInfo(user.publicKey))?.lamports,
    ).toEqual(LAMPORTS_PER_SOL)
  })

  it('cannot withdraw stake account not funded to a settlement', async () => {
    const fakeSettlement = Keypair.generate().publicKey
    const stakeAccount = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount: configAccount,
      voteAccount,
      lamports: LAMPORTS_PER_SOL * 5,
    })

    const { instruction } = await resetStakeInstruction({
      program,
      configAccount: configAccount,
      stakeAccount,
      voteAccount,
      settlementAccount: fakeSettlement,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error(
        'Expected error as stake account is not funded to a settlement',
      )
    } catch (e) {
      verifyError(e, Errors, 6046, 'Stake account staker authority mismatches')
    }
  })

  it('cannot withdraw with existing settlement', async () => {
    const { settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: await currentEpoch(provider),
    })
    const stakeAccount = await createSettlementFundedInitializedStake({
      program,
      provider,
      configAccount: configAccount,
      settlementAccount: settlementAccount,
      lamports: LAMPORTS_PER_SOL * 5,
    })

    const { instruction } = await withdrawStakeInstruction({
      program,
      configAccount: configAccount,
      stakeAccount,
      settlementAccount,
      operatorAuthority: operatorAuthority.publicKey,
      withdrawTo: user.publicKey,
    })
    try {
      await provider.sendIx([operatorAuthority], instruction)
      throw new Error('Expected error; settlement account exists')
    } catch (e) {
      verifyError(e, Errors, 6027, 'Settlement has to be closed')
    }
  })

  it('withdraws delegated, fully-deactivated, sub-minimal stake to operator', async () => {
    const fakeSettlement = Keypair.generate().publicKey
    const rentExempt = await getRentExemptStake(provider)
    const stakeAccount = await fundedDeactivatedDelegatedStake(
      fakeSettlement,
      2 * LAMPORTS_PER_SOL + rentExempt, // delegatable so DelegateStake succeeds
      rentExempt + 0.01 * LAMPORTS_PER_SOL, // end below minimal_size_stake_account (rent + 1 SOL)
    )
    const userBefore = (await provider.connection.getAccountInfo(user.publicKey))
      ?.lamports
    const finalLamports = (
      await provider.connection.getAccountInfo(stakeAccount)
    )?.lamports
    const { instruction } = await withdrawStakeInstruction({
      program,
      configAccount,
      stakeAccount,
      operatorAuthority: operatorAuthority.publicKey,
      settlementAccount: fakeSettlement,
      withdrawTo: user.publicKey,
    })
    await provider.sendIx([operatorAuthority], instruction)
    await assertNotExist(provider, stakeAccount) // drained + closed
    expect(
      (await provider.connection.getAccountInfo(user.publicKey))?.lamports,
    ).toEqual((userBefore ?? 0) + (finalLamports ?? 0))
  })

  it('cannot withdraw deactivated stake that is big enough to be reset', async () => {
    const fakeSettlement = Keypair.generate().publicKey
    const rentExempt = await getRentExemptStake(provider)
    const stakeAccount = await fundedDeactivatedDelegatedStake(
      fakeSettlement,
      2 * LAMPORTS_PER_SOL + rentExempt, // stays >= minimal_size_stake_account
    )
    const { instruction } = await withdrawStakeInstruction({
      program,
      configAccount,
      stakeAccount,
      operatorAuthority: operatorAuthority.publicKey,
      settlementAccount: fakeSettlement,
      withdrawTo: user.publicKey,
    })
    try {
      await provider.sendIx([operatorAuthority], instruction)
      throw new Error('Expected error; stake is big enough to be reset')
    } catch (e) {
      verifyError(e, Errors, 6080, 'big enough to be reset')
    }
    expect(
      await provider.connection.getAccountInfo(stakeAccount),
    ).not.toBeNull()
  })

  it('cannot withdraw deactivated sub-minimal stake without operator authority', async () => {
    const fakeSettlement = Keypair.generate().publicKey
    const rentExempt = await getRentExemptStake(provider)
    const stakeAccount = await fundedDeactivatedDelegatedStake(
      fakeSettlement,
      2 * LAMPORTS_PER_SOL + rentExempt,
      rentExempt + 0.01 * LAMPORTS_PER_SOL,
    )
    const notOperator = Keypair.generate()
    const { instruction } = await withdrawStakeInstruction({
      program,
      configAccount,
      stakeAccount,
      operatorAuthority: notOperator.publicKey,
      settlementAccount: fakeSettlement,
      withdrawTo: user.publicKey,
    })
    try {
      await provider.sendIx([notOperator], instruction)
      throw new Error('Expected error; signer is not the operator authority')
    } catch (e) {
      verifyError(e, Errors, 6003, 'operator authority')
    }
  })
})
